/**
 * Runs one archive collection job in a dedicated worker thread.
 */
import { Worker } from "node:worker_threads";
import { runArchiveCollector } from "../runtime/archiveCollectorRuntime.js";
import { CollectorRunSummary, CollectorWorkerInput, CollectorWorkerResult } from "../types.js";
import { resolveCollectorWorkerExecArgv, resolveCollectorWorkerFileUrl } from "./collectorWorkerRuntime.js";

export async function runCollectorWorker(input: CollectorWorkerInput, timeoutMs: number): Promise<CollectorRunSummary> {
  if (import.meta.url.endsWith(".ts")) {
    return runWithTimeout(runArchiveCollector(input), timeoutMs, "Collector");
  }

  return new Promise<CollectorRunSummary>((resolve, reject) => {
    let settled = false;

    const worker = new Worker(resolveCollectorWorkerFileUrl(import.meta.url), {
      workerData: input,
      execArgv: resolveCollectorWorkerExecArgv(import.meta.url)
    });

    const timeout = setTimeout(() => {
      void worker.terminate();
      if (settled) return;
      settled = true;
      reject(new Error(`Collector worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    worker.once("message", (message: CollectorWorkerResult) => {
      clearTimeout(timeout);
      void worker.terminate();
      if (settled) return;
      settled = true;

      if (message.ok && message.summary) {
        resolve(message.summary);
        return;
      }

      reject(new Error(message.error ?? "Collector worker failed"));
    });

    worker.once("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });

    worker.once("exit", (code) => {
      if (code === 0 || settled) return;
      clearTimeout(timeout);
      settled = true;
      reject(new Error(`Collector worker exited with code ${code}`));
    });
  });
}

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
