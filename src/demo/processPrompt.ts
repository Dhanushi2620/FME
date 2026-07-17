import * as fs from "fs";
import { processBeforeSubmitPrompt } from "../integration/cursor";
import { createHookLogger } from "../integration/cursor/hookLogger";
import {
  buildFailOpenHookResponse,
  buildHookResponseFromOutputPrompt,
  BeforeSubmitPromptHookResponse,
} from "./buildHookResponse";
import { createLogger } from "../logging";

const hookRunnerLogger = createLogger("feedback-memory-hook");

/**
 * Cursor hook runner for beforeSubmitPrompt.
 *
 * When invoked with `--hook-payload`, writes JSON hook output to stdout.
 * The production shell hook runs the compiled script at
 * `dist/hook/demo/processPrompt.js` — run `npm run build:hook` after source
 * changes under `src/`.
 */

/** Hook trace logging via Winston — stderr only. */
function debugHook(message: string, data?: unknown): void {
  hookRunnerLogger.debug(message, data !== undefined ? { data } : undefined);
}

const writeHookResponse = (response: BeforeSubmitPromptHookResponse): void => {
  process.stdout.write(`${JSON.stringify(response)}\n`);
};

const redirectConsoleLogToStderr = (): (() => void) => {
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    hookRunnerLogger.info(
      args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ")
    );
  };

  return () => {
    console.log = originalLog;
  };
};

const runHookPayload = async (
  payloadPath: string
): Promise<BeforeSubmitPromptHookResponse> => {
  let originalPrompt = "";
  const restoreConsoleLog = redirectConsoleLogToStderr();
  let hookLogger: ReturnType<typeof createHookLogger> | undefined;

  try {
    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    originalPrompt = String(payload.prompt ?? "");
    const sessionId = String(payload.conversation_id ?? "");
    const promptId = String(payload.generation_id ?? "");

    hookLogger = createHookLogger({
      conversationId: sessionId,
      generationId: promptId,
    });
    hookLogger.started(originalPrompt);

    debugHook("prompt captured");

    const result = await processBeforeSubmitPrompt({
      text: originalPrompt,
      conversationId: sessionId,
      messageId: promptId,
      hookLogger,
    });

    if (result.pendingWrite) {
      await result.pendingWrite;
    }

    debugHook("hook integration", {
      intent: result.intent,
      outputPromptLength: result.outputPrompt.length,
    });

    hookLogger.completed();

    return buildHookResponseFromOutputPrompt(result.outputPrompt);
  } catch (error) {
    debugHook("hook integration fail-open", {
      error: error instanceof Error ? error.message : String(error),
    });

    hookLogger?.failed(error);

    return buildFailOpenHookResponse(originalPrompt);
  } finally {
    restoreConsoleLog();
  }
};

if (require.main === module) {
  const hookPayloadIndex = process.argv.indexOf("--hook-payload");

  if (hookPayloadIndex !== -1) {
    const payloadPath = process.argv[hookPayloadIndex + 1];

    if (!payloadPath) {
      debugHook("missing payload path");
      writeHookResponse(buildFailOpenHookResponse(""));
      process.exit(0);
    }

    void (async () => {
      try {
        const response = await runHookPayload(payloadPath);
        writeHookResponse(response);
        process.exit(0);
      } catch (error) {
        debugHook("hook integration fail-open", {
          error: error instanceof Error ? error.message : String(error),
        });
        const hookLogger = createHookLogger({
          conversationId: "",
          generationId: "",
        });
        hookLogger.started();
        hookLogger.failed(error);
        writeHookResponse(buildFailOpenHookResponse(""));
        process.exit(0);
      }
    })();
  } else {
    void (async () => {
      try {
        const result = await processBeforeSubmitPrompt({
          text: "Use JWT instead of Firebase",
          conversationId: "cursor-session-001",
          messageId: "prompt-001",
        });
        process.stdout.write(`${result.outputPrompt}\n`);
      } catch (error) {
        debugHook("demo prompt fail-open", {
          error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
      }
    })();
  }
}
