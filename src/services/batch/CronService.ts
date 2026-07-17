/**
 * Long-running cron process:
 *   - Every 15 minutes: fire batch WRITE on unprocessed buffer entries
 *   - Every 24 hours: extract skills from prompt_buffer + cleanup old entries
 *
 * Start via `.cursor/hooks/run_cron.sh` or `feedback-memory-inference/run_all.sh`.
 * Compiles to `dist/hook/services/batch/CronService.js` via `npm run build:hook`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import {
  cleanupOldEntries,
  getUnprocessedBuffer,
  groupByConversationId,
  markEntriesAsProcessed,
  readBuffer,
  writeBatchSnapshot,
} from "./BufferManager";

const BATCH_INTERVAL_MS = 15 * 60 * 1000;
const SKILL_INTERVAL_MS = 24 * 60 * 60 * 1000;

process.env.FME_HOOK_LOG = path.join(
  process.env.HOME || "",
  "Downloads/fme/.cursor/hooks/feedback-memory-hook.log"
);

const toIST = (): string => {
  return new Date()
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

const cronLog = (msg: string): void => {
  const line = `${toIST()} IST [Cron] ${msg}\n`;
  const logFile = path.join(
    process.env.HOME || "",
    "Downloads/fme/.cursor/hooks/feedback-memory-hook.log"
  );
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    console.log("[Cron]", msg);
  }
};

/** JOB 1 — Every 15 minutes: fire batch on unprocessed entries */
const runCron = (): void => {
  try {
    const buffer = getUnprocessedBuffer();
    cronLog(`Cron tick — buffer has ${buffer.length} unprocessed entries`);

    if (buffer.length === 0) {
      cronLog("Buffer empty — skipping");
      return;
    }

    const snapshot = [...buffer];
    writeBatchSnapshot(snapshot);

    const runBatchScript = path.join(__dirname, "runBatch.js");
    const child = spawn(process.execPath, [runBatchScript], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
      cwd: path.join(process.env.HOME || "", "Downloads/fme"),
    });
    child.unref();

    markEntriesAsProcessed(snapshot.map((e) => e.generationId));
    cronLog(`Marked ${snapshot.length} entries as processed`);
    cronLog(`Batch fired: ${snapshot.length} entries`);
  } catch (error) {
    cronLog(
      `Batch job error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/** JOB 2 + 3 — Every 24 hours: skill creation then cleanup */
const runSkillAndCleanup = async (): Promise<void> => {
  try {
    cronLog("24hr job started — skill creation + cleanup");
    const allEntries = readBuffer();

    if (allEntries.length === 0) {
      cronLog("24hr job — buffer empty");
    } else {
      const grouped = groupByConversationId(allEntries);
      cronLog(
        `Checking ${Object.keys(grouped).length} conversations for skills`
      );

      for (const [convId, entries] of Object.entries(grouped)) {
        if (entries.length < 1) continue;

        const conversationString = entries
          .map(
            (e, i) =>
              `Turn ${i + 1}:\nDeveloper: ${e.developerText}\nCursor AI: ${e.aiResponse || "no response captured"}`
          )
          .join("\n\n");

        try {
          const response = await fetch("http://127.0.0.1:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "qwen2.5:3b",
              stream: false,
              messages: [
                {
                  role: "system",
                  content:
                    "You extract reusable engineering workflows from developer conversations in Cursor IDE. Cursor means the IDE tool not PostgreSQL cursors. Return JSON only using { } objects not [ ] arrays.",
                },
                {
                  role: "user",
                  content: `Analyze this conversation:\n\n${conversationString}\n\nDoes a reusable step-by-step workflow emerge?\nReturn JSON only:\n{\n  "hasSkill": boolean,\n  "title": "short title",\n  "steps": ["step 1", "step 2"],\n  "technologies": ["Tech1"],\n  "confidence": 0.0\n}\nIf no workflow: { "hasSkill": false, "title": "", "steps": [], "technologies": [], "confidence": 0 }`,
                },
              ],
            }),
          });

          const data = (await response.json()) as {
            message?: { content?: string };
          };
          const text = data.message?.content || "{}";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            cronLog(`No JSON for convId ${convId}`);
            continue;
          }

          const result = JSON.parse(jsonMatch[0]) as {
            hasSkill?: boolean;
            title?: string;
            steps?: string[];
            technologies?: string[];
            confidence?: number;
          };

          if (!result.hasSkill || (result.confidence ?? 0) < 0.7) {
            cronLog(
              `No skill for convId ${convId} confidence:${result.confidence}`
            );
            continue;
          }

          const techToGlob: Record<string, string[]> = {
            TypeScript: ["src/**/*.ts", "src/**/*.tsx"],
            JavaScript: ["src/**/*.js"],
            Express: ["src/routes/**/*.ts", "src/controllers/**/*.ts"],
            React: ["src/components/**/*.tsx"],
            Redis: ["src/services/**/*.ts", "src/events/**/*.ts"],
            Zod: ["src/**/*.ts"],
            PostgreSQL: ["src/**/*.ts", "prisma/**/*.prisma"],
            Prisma: ["prisma/**/*.prisma"],
          };
          const globs = [
            ...new Set(
              (result.technologies || []).flatMap(
                (t: string) => techToGlob[t] || []
              )
            ),
          ];
          const filename =
            (result.title || "workflow")
              .toLowerCase()
              .replace(/\s+/g, "-")
              .replace(/[^a-z0-9-]/g, "") + "-skill.mdc";
          const globLine =
            globs.length > 0
              ? `globs: [${globs.map((g: string) => `"${g}"`).join(", ")}]\n`
              : "";
          const today = new Date().toISOString().split("T")[0];
          const steps = (result.steps || [])
            .map((s: string, i: number) => `${i + 1}. ${s}`)
            .join("\n");
          const content = `---\ndescription: "${result.title}"\n${globLine}alwaysApply: false\nfme_score: ${(result.confidence ?? 0).toFixed(3)}\nfme_created: "${today}"\n---\n\n# ${result.title}\n\n${steps}\n`;

          const rulesDir = path.join(
            os.homedir(),
            "Downloads",
            "fme",
            ".cursor",
            "rules"
          );
          if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
          }
          fs.writeFileSync(path.join(rulesDir, filename), content);
          cronLog(
            `Skill created: ${filename} confidence:${result.confidence} convId:${convId}`
          );
        } catch (err) {
          cronLog(
            `Skill extraction error convId ${convId}: ${err}`
          );
        }
      }
    }

    cleanupOldEntries();
    cronLog("24hr cleanup complete");
  } catch (err) {
    cronLog(`24hr job error: ${err}`);
  }
};

cronLog("Cron started — batch every 15m, skills+cleanup every 24h");

// Run immediately on start
runCron();
void runSkillAndCleanup();

setInterval(runCron, BATCH_INTERVAL_MS);
setInterval(() => {
  void runSkillAndCleanup();
}, SKILL_INTERVAL_MS);
