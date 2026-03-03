/**
 * Worker entrypoint that executes one strategy module.
 */
import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { StrategyWorkerThreadInput, StrategyWorkerThreadResult } from "./workerTypes.js";
import { StrategyWorkerOutput } from "../types.js";

function assertPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error("strategyWorker must run in a worker thread");
  }
  return parentPort;
}

function assertOutputShape(output: StrategyWorkerOutput): StrategyWorkerOutput {
  if (!output || !Array.isArray(output.messages) || !Array.isArray(output.positionEvents) || !Array.isArray(output.trackedSymbols)) {
    throw new Error("Invalid strategy output shape");
  }
  return output;
}

async function run(): Promise<void> {
  const port = assertPort();
  const input = workerData as StrategyWorkerThreadInput;

  try {
    const moduleUrl = pathToFileURL(input.modulePath).toString();
    const strategyModule = await import(moduleUrl);

    if (typeof strategyModule.entry !== "function") {
      throw new Error(`Strategy module '${input.modulePath}' must export async function entry(input)`);
    }

    const outputRaw = await strategyModule.entry(input.payload);
    const output = assertOutputShape(outputRaw as StrategyWorkerOutput);

    const result: StrategyWorkerThreadResult = {
      ok: true,
      output
    };
    port.postMessage(result);
  } catch (error) {
    const result: StrategyWorkerThreadResult = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
    port.postMessage(result);
  }
}

void run();
