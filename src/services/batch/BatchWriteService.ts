/**
 * Batch WRITE path — classifies buffered prompts, extracts metadata, deduplicates,
 * and persists memories in bulk.
 *
 * Live Cursor WRITE path (Cron). Uses BART 5-way candidate labels (LABELS_5WAY) —
 * Correction / Decision / AntiPattern / TaskLearning / NotMemoryWorthy — not the
 * LEGACY WRITE / READ / ANSWER_ONLY intents in intent.config / BartIntentProvider.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  BufferEntry,
  groupByConversationId,
  markEntriesAsProcessed,
  setLastBatchTimestamp,
} from "./BufferManager";
import {
  createFeedbackMemoryEngine,
  FeedbackMemoryEngine,
} from "../../composition/createFeedbackMemoryEngine";
import { RuleEvaluator } from "../evaluation/RuleEvaluator";
import { ExtractedMetadata, FeedbackCategory } from "../../contracts/extraction";

const BART_CLASSIFY_URL = "http://127.0.0.1:8001/v1/intent/classify";
const OLLAMA_URL = (
  process.env.OLLAMA_URL?.trim() || "http://127.0.0.1:11434"
).replace(/\/$/, "");
const OLLAMA_MODEL =
  process.env.METADATA_MODEL?.trim() || "qwen2.5:3b";

const LABELS_5WAY = [
  "This text states a technical engineering correction about code, architecture, or tooling — not a simple editing request.",
  "This text states a team decision or commitment the whole team should follow going forward.",
  "This text describes a general coding anti-pattern or bad practice the entire team should permanently avoid.",
  "This text explains a step-by-step technical procedure or workflow to follow in this project.",
  "This text asks a question or seeks information — it does not state any rule, decision, correction, or procedure.",
] as const;

const LABEL_TO_CATEGORY: Record<string, string> = {
  "This text states a technical engineering correction about code, architecture, or tooling — not a simple editing request.":
    "Correction",
  "This text states a team decision or commitment the whole team should follow going forward.":
    "Decision",
  "This text describes a general coding anti-pattern or bad practice the entire team should permanently avoid.":
    "AntiPattern",
  "This text explains a step-by-step technical procedure or workflow to follow in this project.":
    "TaskLearning",
  "This text asks a question or seeks information — it does not state any rule, decision, correction, or procedure.":
    "NotMemoryWorthy",
};

const NOT_MEMORY_WORTHY = "NotMemoryWorthy";
const CONFIDENCE_THRESHOLD = 0.5;
const METADATA_QUALITY_THRESHOLD = 0.6;

const DEDUPLICATION_SIMILARITY_THRESHOLD = 0.92;

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

const batchLog = (msg: string): void => {
  const logFile =
    process.env.FME_HOOK_LOG ||
    path.join(
      process.env.HOME || "",
      "Downloads/fme/.cursor/hooks/feedback-memory-hook.log"
    );
  const line = `${toIST()} IST [BatchWrite] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    console.error("[BatchWrite]", msg);
  }
};

const writeOllamaDebugResponse = (rawText: string): void => {
  try {
    const debugPath = path.join(
      process.env.HOME || "",
      "Downloads/fme/.cursor/hooks/ollama_debug.txt"
    );
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, rawText);
  } catch {
    // Debug dump must never fail the batch.
  }

  batchLog(
    `Ollama group raw response preview (see ollama_debug.txt): ${rawText}`
  );
};

const formatError = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
};

type MemoryCategory = FeedbackCategory | typeof NOT_MEMORY_WORTHY;

type ClassifiedEntry = BufferEntry & {
  bartLabel: string;
  confidence: number;
  category: MemoryCategory;
};

type BartLabelScore = {
  label: string;
  score: number;
};

/** Partial metadata returned by the grouped Ollama call (category applied from BART). */
type GroupStatementMetadata = {
  summary: string;
  technologies: string[];
  topics: string[];
  concepts: string[];
  confidence: number;
};

const isFeedbackCategory = (value: string): value is FeedbackCategory => {
  return (
    value === "Correction" ||
    value === "Decision" ||
    value === "AntiPattern" ||
    value === "TaskLearning"
  );
};

const pickTopLabel = (scores: BartLabelScore[]): BartLabelScore | null => {
  if (scores.length === 0) {
    return null;
  }

  return scores.reduce((best, current) =>
    current.score > best.score ? current : best
  );
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const clampConfidence = (score: number): number => {
  if (!Number.isFinite(score)) {
    return 0;
  }
  if (score < 0) {
    return 0;
  }
  if (score > 1) {
    return 1;
  }
  return score;
};

/** Build Turn N conversation string from all buffer entries for a conversation. */
const buildConversationContext = (entries: BufferEntry[]): string => {
  return entries
    .map((entry, index) => {
      const turn = index + 1;
      const developer = entry.developerText ?? "";
      const ai = entry.aiResponse ?? "";
      return `Turn ${turn}:\nDeveloper: ${developer}\nCursor AI: ${ai}`;
    })
    .join("\n\n");
};

const buildGroupExtractionPrompt = (
  conversationString: string,
  keptStatements: ClassifiedEntry[]
): string => {
  const statementsBlock = keptStatements
    .map(
      (entry, index) =>
        `Statement ${index + 1}: '${entry.developerText}' — Category: ${entry.category} (from BART)`
    )
    .join("\n");

  return `Here is a complete developer conversation:

${conversationString}

From this conversation, extract metadata for these
specific memory-worthy statements that were identified:

${statementsBlock}

For EACH statement, extract:
- summary: Write a complete standalone summary that:
  * States the engineering decision, rule, or pattern clearly
  * Explains WHY it was decided (context from conversation)
  * Mentions specific technologies involved
  * Is written so someone with no context understands it fully
  * Does NOT quote the developer text verbatim
  * Is 2-4 sentences minimum
  * Example good summary: "The team chose PostgreSQL over MongoDB
    for all persistent data storage due to better transaction
    support and complex query performance. MongoDB is not to be
    introduced for any new features in this project."
  * Example bad summary: "'we decided PostgreSQL' — this decision..."
- technologies: ["list", "of", "specific", "tools", "libraries", "frameworks", "mentioned"]
- topics: ["list", "of", "broader", "domain", "topics", "like", "database", "security", "auth"]
- confidence: 0.0-1.0

technologies: extract ALL specific tools, libraries, frameworks mentioned
              in the conversation. Never return an empty array if any
              technology is mentioned.
topics: extract 1-3 broad domain topics that categorize this memory.
        Examples: Database, Security, Authentication, API, Validation,
        Architecture, Performance, Testing. Never return an empty array.

Do NOT re-classify the category — it is already known.

Return a JSON array where each element is an object with curly braces:
[
  {
    "summary": "descriptive summary here",
    "technologies": ["Tech1", "Tech2"],
    "topics": ["Topic1", "Topic2"],
    "confidence": 0.95
  }
]

IMPORTANT: Each statement result must use { } curly braces, NOT [ ] square brackets.
The outer container is an array [ ] but each item inside must be an object { }.`;
};

const parseGroupMetadataArray = (
  parsed: unknown,
  expectedCount: number
): GroupStatementMetadata[] | null => {
  if (!Array.isArray(parsed)) {
    return null;
  }

  const results: GroupStatementMetadata[] = [];

  for (let i = 0; i < expectedCount; i += 1) {
    const item = parsed[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      results.push({
        summary: "",
        technologies: [],
        topics: [],
        concepts: [],
        confidence: 0,
      });
      continue;
    }

    const record = item as Record<string, unknown>;
    const summary =
      typeof record.summary === "string" ? record.summary.trim() : "";

    results.push({
      summary,
      technologies: normalizeStringArray(record.technologies),
      topics: normalizeStringArray(record.topics),
      concepts: normalizeStringArray(record.concepts),
      confidence: clampConfidence(
        typeof record.confidence === "number" ? record.confidence : 0
      ),
    });
  }

  return results;
};

/**
 * ONE Ollama call per conversationId group.
 * Returns metadata aligned by index with keptStatements.
 */
const extractGroupWithOllama = async (
  convId: string,
  contextEntries: BufferEntry[],
  keptStatements: ClassifiedEntry[]
): Promise<GroupStatementMetadata[] | null> => {
  const conversationString = buildConversationContext(contextEntries);
  const prompt = buildGroupExtractionPrompt(conversationString, keptStatements);

  batchLog(
    `Sending group to Ollama: conv=${convId} contextTurns=${contextEntries.length} statements=${keptStatements.length}`
  );

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "IMPORTANT CONTEXT: You are analyzing conversations from Cursor IDE\n" +
              "(an AI-powered code editor). When you see 'Cursor AI' or 'Cursor'\n" +
              "in the conversation, it refers to the IDE tool, NOT PostgreSQL\n" +
              "database cursors or any other type of cursor.\n" +
              "\n" +
              "Do not confuse:\n" +
              "- Cursor IDE (the code editor tool) with PostgreSQL cursors\n" +
              "- Any mentions of 'cursor' in the conversation context with\n" +
              "  database cursor operations\n" +
              "\n" +
              "You are a senior software engineering knowledge extractor.\n" +
              "Your job is to extract high-quality, searchable metadata\n" +
              "from developer conversations in Cursor IDE.\n" +
              "\n" +
              "For summaries: write clear, standalone engineering knowledge\n" +
              "that can be retrieved and understood without any context.\n" +
              "Never quote developer text verbatim. Always explain WHY\n" +
              "a decision was made, not just WHAT was decided.\n" +
              "Focus on the actual engineering decision — not on the tool\n" +
              "used to have the conversation.\n" +
              "\n" +
              "For technologies: extract ALL specific tools, libraries,\n" +
              "frameworks, databases mentioned in the CODE being discussed.\n" +
              "Ignore Cursor IDE itself as a technology.\n" +
              "Never return empty array if any technology is mentioned.\n" +
              "\n" +
              "For topics: use broad domain categories like Database,\n" +
              "Security, Authentication, API, Validation, Architecture,\n" +
              "Performance, Testing. Always return at least one topic.\n" +
              "\n" +
              "Return valid JSON only. Use { } objects not [ ] arrays\n" +
              "for each result item.",
          },
          { role: "user", content: prompt },
        ],
        stream: false,
        options: { temperature: 0.1, num_ctx: 8192 },
      }),
    });

    if (!response.ok) {
      batchLog(
        `Ollama group HTTP error for ${convId}: status ${response.status}`
      );
      return null;
    }

    const payload = (await response.json()) as {
      message?: { content?: string };
    };
    const content = payload.message?.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      batchLog(`Ollama group empty content for ${convId}`);
      return null;
    }

    const rawText = content.trim();

    batchLog(
      `Ollama group raw response for ${convId}: ${rawText}`
    );

    // Try direct parse first
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try extracting JSON array from response
      const arrayMatch = rawText.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          parsed = JSON.parse(arrayMatch[0]);
        } catch {
          writeOllamaDebugResponse(rawText);
          batchLog(
            `Ollama group JSON parse failed for ${convId}: ${rawText}`
          );
          return null;
        }
      } else {
        batchLog(
          `Ollama group no JSON array found for ${convId}: ${rawText}`
        );
        return null;
      }
    }

    if (Array.isArray(parsed)) {
      parsed = parsed
        .map((item) => {
          // If item is array instead of object (Ollama mistake), skip it
          if (Array.isArray(item)) {
            batchLog("Ollama returned array instead of object — skipping");
            return null;
          }
          return item;
        })
        .filter(Boolean);
    }

    const mapped = parseGroupMetadataArray(parsed, keptStatements.length);
    if (!mapped) {
      writeOllamaDebugResponse(rawText);
      batchLog(`Ollama group JSON parse failed for ${convId}`);
      return null;
    }

    return mapped;
  } catch (err) {
    batchLog(`Ollama group error for ${convId}: ${formatError(err)}`);
    return null;
  }
};

const classifyEntryWithBart = async (
  developerText: string,
  index: number
): Promise<{ category: MemoryCategory; confidence: number; topLabel: string } | null> => {
  try {
    batchLog(`Classifying entry ${index}: ${developerText}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    batchLog(`Calling BART for entry ${index}...`);

    let response: Response;
    try {
      response = await fetch(BART_CLASSIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: developerText,
          candidate_labels: LABELS_5WAY,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      batchLog(`BART raw response status: ${response.status}`);
    } catch (err) {
      clearTimeout(timeout);
      batchLog(`BART fetch error for entry ${index}: ${formatError(err)}`);
      return null;
    }

    batchLog(`BART responded for entry ${index}`);

    if (!response.ok) {
      batchLog(
        `BART HTTP error for entry ${index}: status ${response.status}`
      );
      return null;
    }

    const result = (await response.json()) as {
      labels?: Array<{ label?: string; score?: number }>;
    };

    if (!result.labels || !Array.isArray(result.labels)) {
      batchLog(`BART invalid response for entry ${index}: missing labels`);
      return null;
    }

    const scores: BartLabelScore[] = [];

    for (const labelEntry of result.labels) {
      if (
        typeof labelEntry.label !== "string" ||
        typeof labelEntry.score !== "number"
      ) {
        continue;
      }

      scores.push({ label: labelEntry.label, score: labelEntry.score });
    }

    const top = pickTopLabel(scores);

    if (!top) {
      batchLog(`BART no usable label for entry ${index}`);
      return null;
    }

    const topLabel = top.label;
    const category =
      (LABEL_TO_CATEGORY[topLabel] as MemoryCategory | undefined) ??
      NOT_MEMORY_WORTHY;
    const confidence = top.score;

    batchLog(`BART result: ${category} confidence:${confidence}`);

    return { category, confidence, topLabel };
  } catch (err) {
    batchLog(`BART error for entry ${index}: ${formatError(err)}`);
    return null;
  }
};

export class BatchWriteService {
  private static engine: Awaited<
    ReturnType<typeof createFeedbackMemoryEngine>
  > | null = null;

  static async ensureEngine(): Promise<void> {
    if (!BatchWriteService.engine) {
      batchLog("Creating FeedbackMemoryEngine...");
      BatchWriteService.engine = await createFeedbackMemoryEngine();
      batchLog(`FeedbackMemoryEngine ready: ${!!BatchWriteService.engine}`);
    }
  }

  static async execute(buffer: BufferEntry[]): Promise<void> {
    try {
      batchLog(`Batch started: ${buffer.length} entries`);
      await BatchWriteService.ensureEngine();

      const classified: ClassifiedEntry[] = [];

      for (let i = 0; i < buffer.length; i += 1) {
        const entry = buffer[i];
        const bartResult = await classifyEntryWithBart(entry.developerText, i);

        if (!bartResult) {
          classified.push({
            ...entry,
            bartLabel: LABELS_5WAY[4],
            confidence: 0,
            category: NOT_MEMORY_WORTHY,
          });
          continue;
        }

        classified.push({
          ...entry,
          bartLabel: bartResult.topLabel,
          confidence: bartResult.confidence,
          category: bartResult.category,
        });
      }

      batchLog(`Classification loop complete: ${classified.length} entries`);

      const kept = classified.filter(
        (entry) =>
          entry.category !== NOT_MEMORY_WORTHY &&
          entry.confidence >= CONFIDENCE_THRESHOLD &&
          isFeedbackCategory(entry.category)
      );

      batchLog(`After filter: kept=${kept.length}`);

      const grouped = groupByConversationId(kept);
      // Full buffer (kept + noise) for conversation context per convId.
      const contextByConversation = groupByConversationId(buffer);

      let storedCount = 0;
      let skippedCount = classified.length - kept.length;

      for (const [convId, conversationEntries] of Object.entries(grouped)) {
        const keptEntries = conversationEntries as ClassifiedEntry[];
        batchLog(`Group ${convId}: ${keptEntries.length} entries → Ollama`);

        const contextEntries = contextByConversation[convId] ?? keptEntries;

        try {
          const groupResults = await extractGroupWithOllama(
            convId,
            contextEntries,
            keptEntries
          );

          if (!groupResults) {
            skippedCount += keptEntries.length;
            batchLog(`Group ${convId}: Ollama failed — skipping all statements`);
            continue;
          }

          for (let i = 0; i < keptEntries.length; i += 1) {
            const entry = keptEntries[i];
            const partial = groupResults[i];

            if (!isFeedbackCategory(entry.category)) {
              skippedCount += 1;
              continue;
            }

            if (!partial || !partial.summary) {
              skippedCount += 1;
              continue;
            }

            // Apply BART category — do not let Ollama re-classify.
            const metadata: ExtractedMetadata = {
              category: entry.category,
              summary: partial.summary,
              technologies: partial.technologies,
              topics: partial.topics,
              concepts: partial.concepts,
              confidence: partial.confidence,
            };

            batchLog(
              `Ollama result [${i}]: ${JSON.stringify(metadata)}`
            );

            // Write full metadata to separate analysis file
            const METADATA_LOG = path.join(
              os.homedir(),
              "Downloads/fme/.cursor/hooks/ollama_metadata.log"
            );
            const metaLine =
              `${toIST()} IST ─────────────────────────────\n` +
              `convId:      ${entry.conversationId}\n` +
              `genId:       ${entry.generationId}\n` +
              `devText:     ${entry.developerText}\n` +
              `category:    ${metadata.category}\n` +
              `summary:     ${metadata.summary}\n` +
              `technologies:${JSON.stringify(metadata.technologies)}\n` +
              `topics:      ${JSON.stringify(metadata.topics)}\n` +
              `confidence:  ${metadata.confidence}\n\n`;
            try {
              fs.mkdirSync(path.dirname(METADATA_LOG), { recursive: true });
              fs.appendFileSync(METADATA_LOG, metaLine);
            } catch {
              // Metadata analysis log must never fail the batch.
            }

            try {
              const outcome = await BatchWriteService.persistEntry(
                entry,
                metadata
              );

              if (outcome === "stored") {
                storedCount += 1;
              } else {
                skippedCount += 1;
              }
            } catch (err) {
              batchLog(`Entry processing error: ${formatError(err)}`);
              skippedCount += 1;
            }
          }
        } catch (err) {
          batchLog(`Group ${convId} error: ${formatError(err)}`);
          skippedCount += keptEntries.length;
        }
      }

      // Count-trigger workers (runBatch) mark here; CronService also marks after execute.
      markEntriesAsProcessed(buffer.map((entry) => entry.generationId));
      setLastBatchTimestamp();

      batchLog(`Batch complete: stored=${storedCount} skipped=${skippedCount}`);
    } catch (err) {
      batchLog(`FATAL batch error: ${formatError(err)}`);
      throw err;
    }
  }

  private static async persistEntry(
    entry: ClassifiedEntry,
    metadata: ExtractedMetadata
  ): Promise<"stored" | "skipped"> {
    const engine: FeedbackMemoryEngine | null = BatchWriteService.engine;
    if (!engine) {
      batchLog("Engine not initialized — skipping entry");
      return "skipped";
    }

    if (metadata.confidence < METADATA_QUALITY_THRESHOLD) {
      return "skipped";
    }

    if (!metadata.summary || metadata.summary.trim().length === 0) {
      return "skipped";
    }

    const embeddingService = engine.embedding;
    const vectorStoreService = engine.vectorStore;

    let embedding;

    try {
      embedding = await embeddingService.embed({
        text: metadata.summary,
        purpose: "document",
      });
    } catch (err) {
      batchLog(`Embedding error: ${formatError(err)}`);
      return "skipped";
    }

    if (embedding.vector.length === 0) {
      return "skipped";
    }

    let dupCheck;

    try {
      dupCheck = await vectorStoreService.search({
        vector: embedding.vector,
        topK: 1,
        minScore: 0,
        filter: {
          excludeMessageId: entry.generationId,
        },
      });
    } catch (err) {
      batchLog(`ChromaDB search error: ${formatError(err)}`);
      return "skipped";
    }

    if (
      dupCheck.hits.length > 0 &&
      dupCheck.hits[0].score > DEDUPLICATION_SIMILARITY_THRESHOLD
    ) {
      batchLog(`Duplicate skipped: ${entry.generationId}`);
      return "skipped";
    }

    batchLog(`Upserting to ChromaDB: ${metadata.summary}`);

    let stored = false;

    try {
      stored = await vectorStoreService.upsertMemory({
        record: {
          id: entry.generationId,
          vector: embedding.vector,
          metadata: {
            id: entry.generationId,
            category: metadata.category,
            summary: metadata.summary,
            conversationId: entry.conversationId,
            messageId: entry.generationId,
            technologies: metadata.technologies,
            topics: metadata.topics,
            concepts: metadata.concepts,
            confidence: metadata.confidence,
          },
        },
      });
    } catch (err) {
      batchLog(`ChromaDB error: ${formatError(err)}`);
      return "skipped";
    }

    if (!stored) {
      batchLog(`ChromaDB upsert returned false: ${entry.generationId}`);
      return "skipped";
    }

    batchLog(`Upsert complete: ${entry.generationId}`);
    batchLog(
      `Stored memory: ${metadata.category} | ${metadata.summary}`
    );

    const metadataForRules: ExtractedMetadata = metadata;
    void new RuleEvaluator().evaluate(metadataForRules, {
      developerText: entry.developerText,
      aiResponse: entry.aiResponse,
    });

    return "stored";
  }
}
