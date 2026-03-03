/**
 * Handles worker timeout and lifecycle bindings.
 */
import { Worker } from "node:worker_threads";
import { StrategyWorkerThreadResult } from "./workerTypes.js";

export interface WorkerLifecycleHandlers {
  onSuccess: (message: StrategyWorkerThreadResult) => void;
  onError: (error: Error) => void;
}

export function bindWorkerLifecycle(
  worker: Worker,
  timeoutMs: number,
  handlers: WorkerLifecycleHandlers
): NodeJS.Timeout {
  const timeout = setTimeout(() => {
    worker.terminate().catch(() => undefined);
    handlers.onError(new Error(`Worker timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  worker.once("message", (message: StrategyWorkerThreadResult) => {
    clearTimeout(timeout);
    void worker.terminate();
    handlers.onSuccess(message);
  });

  worker.once("error", (error) => {
    clearTimeout(timeout);
    handlers.onError(error);
  });

  return timeout;
}
