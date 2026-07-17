/**
 * Cursor afterAgentResponse hook runner.
 *
 * Reads the hook payload from stdin, updates the matching buffer entry with the
 * assistant response, and always returns fail-open JSON on stdout.
 *
 * Compiled to `dist/hook/demo/updateAiResponse.js` via `npm run build:hook`.
 */

import {
  readBuffer,
  updateAiResponse,
} from "../services/batch/BufferManager";
import { createLogger } from "../logging";

const hookLogger = createLogger("updateAiResponse");

const readStdin = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    process.stdin.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    process.stdin.on("error", reject);
  });
};

const writeContinueResponse = (): void => {
  process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
};

const run = async (): Promise<void> => {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw) as {
      generation_id?: string;
      text?: string;
      prompt?: string;
      response?: string;
    };

    const generationId = String(payload.generation_id ?? "");
    const aiResponse = String(
      payload.text ?? payload.prompt ?? payload.response ?? ""
    );

    if (generationId.length > 0 && aiResponse.length > 0) {
      updateAiResponse(generationId, aiResponse);

      const updatedBuffer = readBuffer();
      const updatedEntry = updatedBuffer.find(
        (e) => e.generationId === generationId
      );
      if (updatedEntry) {
        hookLogger.info("[Buffer] entry updated with aiResponse", {
          generationId: generationId.slice(0, 8),
          developerText: updatedEntry.developerText.slice(0, 50),
          aiResponse: updatedEntry.aiResponse.slice(0, 100),
          conversationId: updatedEntry.conversationId.slice(0, 8),
        });
      }
    }
  } catch (error) {
    hookLogger.error("Failed to update AI response in buffer", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    writeContinueResponse();
    process.exit(0);
  }
};

if (require.main === module) {
  void run();
}
