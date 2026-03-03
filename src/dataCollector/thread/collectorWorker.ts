/**
 * Worker entrypoint for background archive collection.
 */
import { parentPort, workerData } from "node:worker_threads";
import { runArchiveCollector } from "../runtime/archiveCollectorRuntime.js";
import { CollectorWorkerInput, CollectorWorkerResult } from "../types.js";

function assertPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error("collectorWorker must run in a worker thread");
  }
  return parentPort;
}

async function run(): Promise<void> {
  const port = assertPort();
  const input = workerData as CollectorWorkerInput;

  try {
    const summary = await runArchiveCollector(input);
    const result: CollectorWorkerResult = {
      ok: true,
      summary
    };
    port.postMessage(result);
  } catch (error) {
    const result: CollectorWorkerResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    port.postMessage(result);
  }
}

void run();
