/**
 * Shared types for the background market-data collector.
 */
import { ExchangeEndpointConfig } from "../exchange/types.js";

export interface CollectorWorkerInput {
  runId: string;
  exchangeName: string;
  restBaseUrl: string;
  requestTimeoutMs: number;
  maxParallelRequests: number;
  lookbackMinutes: number;
  outputDir: string;
  stateFile: string;
  endpoints: ExchangeEndpointConfig[];
  nowMs: number;
}

export interface CollectorRunSummary {
  runId: string;
  exchange: string;
  symbolsDiscovered: number;
  requestsAttempted: number;
  requestsSucceeded: number;
  requestsFailed: number;
  recordsWritten: number;
  duplicateRecordsSkipped: number;
  minutePointsProcessed: number;
  snapshotRowsProcessed: number;
  windowStartIso: string;
  windowEndIso: string;
  startedAtIso: string;
  finishedAtIso: string;
}

export interface CollectorWorkerResult {
  ok: boolean;
  summary?: CollectorRunSummary;
  error?: string;
}

export interface SymbolArchiveRecord {
  exchange: string;
  symbol: string;
  endpoint: string;
  sourceUrl: string;
  collectedAt: string;
  minute: string;
  minuteMs: number;
  tags: string[];
  payload: unknown;
}

export interface CollectorCursorState {
  cursors: Record<string, number>;
}

export interface MinuteWindow {
  startMs: number;
  endMs: number;
  startSec: number;
  endSec: number;
}

export interface SymbolPayloadRow {
  symbol: string;
  payload: unknown;
}

export interface MinutePoint {
  minuteMs: number;
  payload: unknown;
}

export interface EndpointCollectionResult {
  endpoint: ExchangeEndpointConfig;
  collected: {
    name: string;
    method: "GET" | "POST";
    url: string;
    tags: string[];
    fetchedAt: string;
    latencyMs: number;
    ok: boolean;
    statusCode: number;
    payload: unknown;
    error: string | null;
  };
}

export interface PlannedArchiveEndpoints {
  baseEndpoints: ExchangeEndpointConfig[];
  minuteFanoutEndpoints: ExchangeEndpointConfig[];
  snapshotFanoutEndpoints: ExchangeEndpointConfig[];
}
