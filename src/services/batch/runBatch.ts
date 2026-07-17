/**
 * Detached batch runner — survives after the Cursor hook process exits.
 *
 * Invoked by the hook via `spawn(process.execPath, [runBatch.js], { detached: true })`.
 * Compiles to `dist/hook/services/batch/runBatch.js` via `npm run build:hook`.
 */

import { BatchWriteService } from "./BatchWriteService";
import { takeBatchSnapshot } from "./BufferManager";

const run = async (): Promise<void> => {
  const buffer = takeBatchSnapshot();

  if (buffer.length === 0) {
    process.stderr.write("[runBatch] snapshot empty or missing\n");
    process.exit(0);
    return;
  }

  try {
    await BatchWriteService.execute(buffer);
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `[runBatch] Batch error: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
    process.exit(1);
  }
};

void run();
