/**
 * Payload contracts for worker_threads strategy execution.
 */
import { StrategyWorkerInput, StrategyWorkerOutput } from "../types.js";

export interface StrategyWorkerThreadInput {
  modulePath: string;
  payload: StrategyWorkerInput;
}

export interface StrategyWorkerThreadSuccess {
  ok: true;
  output: StrategyWorkerOutput;
}

export interface StrategyWorkerThreadFailure {
  ok: false;
  error: string;
}

export type StrategyWorkerThreadResult = StrategyWorkerThreadSuccess | StrategyWorkerThreadFailure;
