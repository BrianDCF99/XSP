/**
 * Runs a strategy module in a dedicated worker thread.
 */
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { StrategyDescriptor, StrategyWorkerInput, StrategyWorkerOutput } from "../types.js";
import { bindWorkerLifecycle } from "./workerLifecycle.js";
import { resolveWorkerExecArgv, resolveWorkerFileUrl } from "./workerRuntime.js";
import { StrategyWorkerThreadInput, StrategyWorkerThreadResult } from "./workerTypes.js";

function toWorkerInput(strategy: StrategyDescriptor, input: StrategyWorkerInput): StrategyWorkerThreadInput {
  return {
    modulePath: strategy.modulePath,
    payload: input
  };
}

function toResolvedOutput(strategyName: string, message: StrategyWorkerThreadResult): StrategyWorkerOutput {
  if (message.ok) return message.output;
  throw new Error(`Strategy '${strategyName}' failed: ${message.error}`);
}

function toRejectedError(strategyName: string, error: Error): Error {
  if (error.message.includes("timed out")) {
    return new Error(`Strategy '${strategyName}' timed out`);
  }
  return error;
}

function runningTsRuntime(baseImportMetaUrl: string): boolean {
  return baseImportMetaUrl.endsWith(".ts");
}

function assertOutputShape(output: StrategyWorkerOutput): StrategyWorkerOutput {
  if (!output || !Array.isArray(output.messages) || !Array.isArray(output.positionEvents) || !Array.isArray(output.trackedSymbols)) {
    throw new Error("Invalid strategy output shape");
  }
  return output;
}

async function runStrategyInline(strategy: StrategyDescriptor, input: StrategyWorkerInput): Promise<StrategyWorkerOutput> {
  const moduleUrl = pathToFileURL(strategy.modulePath).toString();
  const strategyModule = await import(moduleUrl);

  if (typeof strategyModule.entry !== "function") {
    throw new Error(`Strategy module '${strategy.modulePath}' must export async function entry(input)`);
  }

  const outputRaw = await strategyModule.entry(input);
  return assertOutputShape(outputRaw as StrategyWorkerOutput);
}

export async function runStrategyInWorker(
  strategy: StrategyDescriptor,
  input: StrategyWorkerInput,
  timeoutMs = 30000
): Promise<StrategyWorkerOutput> {
  if (runningTsRuntime(import.meta.url)) {
    return runStrategyInline(strategy, input);
  }

  const workerInput = toWorkerInput(strategy, input);

  return new Promise<StrategyWorkerOutput>((resolve, reject) => {
    let settled = false;

    const worker = new Worker(resolveWorkerFileUrl(import.meta.url), {
      workerData: workerInput,
      execArgv: resolveWorkerExecArgv(import.meta.url, strategy.modulePath)
    });

    bindWorkerLifecycle(worker, timeoutMs, {
      onSuccess: (message) => {
        if (settled) return;
        settled = true;

        try {
          resolve(toResolvedOutput(strategy.name, message));
        } catch (error) {
          reject(error);
        }
      },
      onError: (error) => {
        if (settled) return;
        settled = true;
        reject(toRejectedError(strategy.name, error));
      }
    });
  });
}
