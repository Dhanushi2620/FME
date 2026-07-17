import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface BufferEntry {
  conversationId: string;
  generationId: string;
  developerText: string;
  aiResponse: string;
  timestamp: string;
  batchProcessed?: boolean;
}

const HOOKS_DIR = path.join(
  os.homedir(),
  "Downloads",
  "fme",
  ".cursor",
  "hooks"
);
const BUFFER_FILE = path.join(HOOKS_DIR, "prompt_buffer.json");
const LAST_BATCH_FILE = path.join(HOOKS_DIR, "last_batch.json");
const SNAPSHOT_FILE = path.join(HOOKS_DIR, "batch_snapshot.json");
const MAX_ENTRY_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const ensureDir = (): void => {
  if (!fs.existsSync(HOOKS_DIR)) {
    fs.mkdirSync(HOOKS_DIR, { recursive: true });
  }
};

export const readBuffer = (): BufferEntry[] => {
  try {
    ensureDir();
    if (!fs.existsSync(BUFFER_FILE)) {
      return [];
    }
    return (JSON.parse(fs.readFileSync(BUFFER_FILE, "utf-8")) as BufferEntry[]) || [];
  } catch {
    return [];
  }
};

const writeBuffer = (entries: BufferEntry[]): void => {
  ensureDir();
  fs.writeFileSync(BUFFER_FILE, JSON.stringify(entries, null, 2));
};

/** Parse buffer timestamps (ISO or "DD/MM/YYYY HH:mm:ss IST"). */
const parseEntryTimestampMs = (timestamp: string): number => {
  const iso = Date.parse(timestamp);
  if (Number.isFinite(iso)) {
    return iso;
  }

  const match = timestamp.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) {
    return NaN;
  }

  const [, dd, mm, yyyy, hh, min, ss] = match;
  return Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:30`);
};

export const cleanupOldEntries = (): void => {
  const entries = readBuffer();
  const now = Date.now();
  // Only remove entries that are BOTH processed AND older than 24h.
  // Keep ALL unprocessed entries regardless of age.
  const fresh = entries.filter((e) => {
    const age = now - parseEntryTimestampMs(e.timestamp);
    const isProcessed = e.batchProcessed === true;
    return !(isProcessed && Number.isFinite(age) && age > MAX_ENTRY_AGE_MS);
  });
  const removed = entries.length - fresh.length;
  if (removed > 0) {
    writeBuffer(fresh);
    console.log(`[Buffer] cleanupOldEntries removed=${removed}`);
  }
};

export const appendToBuffer = (entry: BufferEntry): void => {
  cleanupOldEntries();
  const entries = readBuffer();
  entries.push({ ...entry, batchProcessed: false });
  writeBuffer(entries);
};

export const updateAiResponse = (
  generationId: string,
  aiResponse: string
): void => {
  const entries = readBuffer();
  const index = entries.findIndex((e) => e.generationId === generationId);
  if (index !== -1) {
    entries[index].aiResponse = aiResponse;
    writeBuffer(entries);
  }
};

export const getUnprocessedBuffer = (): BufferEntry[] => {
  return readBuffer().filter((e) => e.batchProcessed !== true);
};

export const markEntriesAsProcessed = (generationIds: string[]): void => {
  const entries = readBuffer();
  const updated = entries.map((e) => ({
    ...e,
    batchProcessed: generationIds.includes(e.generationId)
      ? true
      : e.batchProcessed,
  }));
  writeBuffer(updated);
};

export const clearBuffer = (): void => {
  writeBuffer([]);
};

export const removeProcessedEntries = (generationIds: string[]): void => {
  const entries = readBuffer();
  const remaining = entries.filter(
    (e) => !generationIds.includes(e.generationId)
  );
  writeBuffer(remaining);
};

export const getLastBatchTimestamp = (): number => {
  try {
    if (!fs.existsSync(LAST_BATCH_FILE)) {
      return 0;
    }
    const data = JSON.parse(fs.readFileSync(LAST_BATCH_FILE, "utf-8")) as {
      timestamp?: number;
    };
    return data.timestamp || 0;
  } catch {
    return 0;
  }
};

export const setLastBatchTimestamp = (): void => {
  ensureDir();
  fs.writeFileSync(
    LAST_BATCH_FILE,
    JSON.stringify({ timestamp: Date.now() })
  );
};

export const writeBatchSnapshot = (entries: BufferEntry[]): void => {
  try {
    ensureDir();
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(entries, null, 2));
  } catch {
    // Snapshot writes must never throw to callers.
  }
};

export const takeBatchSnapshot = (): BufferEntry[] => {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) {
      return [];
    }
    const content = fs.readFileSync(SNAPSHOT_FILE, "utf-8");
    fs.writeFileSync(SNAPSHOT_FILE, "[]");
    const parsed = JSON.parse(content) as BufferEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    // Do not remove buffer entries here — BatchWriteService / cron marks
    // them batchProcessed; cleanupOldEntries drops them after 24h.
    return parsed;
  } catch {
    return [];
  }
};

export const groupByConversationId = (
  entries: BufferEntry[]
): Record<string, BufferEntry[]> => {
  return entries.reduce(
    (acc, entry) => {
      const key = entry.conversationId;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(entry);
      return acc;
    },
    {} as Record<string, BufferEntry[]>
  );
};
