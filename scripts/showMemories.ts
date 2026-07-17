/**
 * Developer utility for inspecting stored feedback memories.
 *
 * Uses the configured VectorStoreProvider — does not call ChromaDB directly.
 */

import { VECTOR_STORE_CONFIG } from "../src/config/vector-store.config";
import { createVectorStoreProvider } from "../src/composition/VectorStoreProviderFactory";
import { VectorMemoryMetadata } from "../src/contracts/vector-store";

const MEMORY_SEPARATOR = "====================================================";
const LIST_ALL_LIMIT = 10_000;

const formatListField = (values: string[] | undefined): string => {
  if (!values || values.length === 0) {
    return "(none)";
  }

  return values.join("\n");
};

const formatMemory = (index: number, memory: VectorMemoryMetadata): string => {
  const lines = [
    MEMORY_SEPARATOR,
    "",
    `Memory #${index}`,
    "",
    "ID:",
    memory.id,
    "",
    "Category:",
    memory.category,
    "",
    "Summary:",
    memory.summary,
    "",
    "Technologies:",
    formatListField(memory.technologies),
    "",
    "Topics:",
    formatListField(memory.topics),
    "",
    "Concepts:",
    formatListField(memory.concepts),
    "",
    "Confidence:",
    "(not stored)",
    "",
    "Conversation:",
    memory.conversationId,
    "",
    "Message:",
    memory.messageId,
    "",
    "Timestamp:",
    "(not stored)",
    "",
    MEMORY_SEPARATOR,
    "",
  ];

  return lines.join("\n");
};

const showMemories = async (): Promise<void> => {
  const provider = createVectorStoreProvider(VECTOR_STORE_CONFIG);
  const { memories } = await provider.listMemories({ limit: LIST_ALL_LIMIT });

  if (memories.length === 0) {
    process.stdout.write("No memories stored.\n");
    return;
  }

  memories.forEach((memory, index) => {
    process.stdout.write(formatMemory(index + 1, memory));
  });
};

void showMemories().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to list memories: ${message}\n`);
  process.exit(1);
});
