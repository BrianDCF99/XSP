/**
 * Worker-side runtime that fetches archive endpoints and writes deduped symbol data.
 */
import { collectEndpoint } from "../../exchange/endpointCollector.js";
import { HttpJsonClient } from "../../exchange/httpJsonClient.js";
import { runWithLimit } from "../../exchange/parallelLimiter.js";
import { extractSymbolUniverse } from "../../exchange/symbolUniverseExtractor.js";
import { nowIso } from "../../utils/time.js";
import { extractMinutePoints } from "../extraction/minuteSeriesExtractor.js";
import { extractSymbolFromEndpoint, extractSymbolPayloadRows } from "../extraction/symbolPayloadExtractor.js";
import { planArchiveEndpoints } from "../planning/archiveEndpointPlanner.js";
import { computeMinuteWindow, toMinuteBucketMs } from "../planning/minuteWindow.js";
import { buildCursorKey } from "../state/cursorKey.js";
import { CursorStateStore } from "../state/cursorStateStore.js";
import { SymbolArchiveWriter } from "../storage/symbolArchiveWriter.js";
import { CollectorRunSummary, CollectorWorkerInput, EndpointCollectionResult, SymbolArchiveRecord } from "../types.js";

interface PersistStats {
  recordsWritten: number;
  duplicateRecordsSkipped: number;
  minutePointsProcessed: number;
  snapshotRowsProcessed: number;
}

interface RequestStats {
  requestsAttempted: number;
  requestsSucceeded: number;
  requestsFailed: number;
}

const GLOBAL_SYMBOL = "__GLOBAL__";

export async function runArchiveCollector(input: CollectorWorkerInput): Promise<CollectorRunSummary> {
  const startedAtIso = nowIso();
  const minuteWindow = computeMinuteWindow(input.nowMs, input.lookbackMinutes);

  const client = new HttpJsonClient(input.requestTimeoutMs);
  const cursorStore = new CursorStateStore(input.stateFile);
  const cursors = await cursorStore.load();
  const writer = new SymbolArchiveWriter(input.outputDir);

  const enabledEndpoints = input.endpoints.filter((endpoint) => endpoint.enabled);
  const baseEndpoints = enabledEndpoints.filter((endpoint) => !endpoint.symbolFanout);

  const baseResults = await collectMany(client, input, baseEndpoints);
  const symbols = extractSymbolUniverse(baseResults.map((result) => result.collected));

  const planned = planArchiveEndpoints(enabledEndpoints, symbols, minuteWindow);
  const minuteFanoutResults = await collectMany(client, input, planned.minuteFanoutEndpoints);
  const snapshotFanoutResults = await collectMany(client, input, planned.snapshotFanoutEndpoints);

  const persistStats = await persistCollectedResults(
    input,
    minuteWindow,
    cursors,
    writer,
    baseResults,
    snapshotFanoutResults,
    minuteFanoutResults
  );

  await cursorStore.save(cursors);

  const requestStats = summarizeRequestStats([...baseResults, ...snapshotFanoutResults, ...minuteFanoutResults]);

  return {
    runId: input.runId,
    exchange: input.exchangeName,
    symbolsDiscovered: symbols.length,
    requestsAttempted: requestStats.requestsAttempted,
    requestsSucceeded: requestStats.requestsSucceeded,
    requestsFailed: requestStats.requestsFailed,
    recordsWritten: persistStats.recordsWritten,
    duplicateRecordsSkipped: persistStats.duplicateRecordsSkipped,
    minutePointsProcessed: persistStats.minutePointsProcessed,
    snapshotRowsProcessed: persistStats.snapshotRowsProcessed,
    windowStartIso: new Date(minuteWindow.startMs).toISOString(),
    windowEndIso: new Date(minuteWindow.endMs).toISOString(),
    startedAtIso,
    finishedAtIso: nowIso()
  };
}

async function collectMany(
  client: HttpJsonClient,
  input: CollectorWorkerInput,
  endpoints: CollectorWorkerInput["endpoints"]
): Promise<EndpointCollectionResult[]> {
  if (endpoints.length === 0) return [];

  const tasks = endpoints.map((endpoint) => {
    return async (): Promise<EndpointCollectionResult> => {
      const collected = await collectEndpoint({
        exchangeName: input.exchangeName,
        restBaseUrl: input.restBaseUrl,
        endpoint,
        client,
        onFailure: () => undefined
      });

      return {
        endpoint,
        collected
      };
    };
  });

  return runWithLimit(tasks, input.maxParallelRequests);
}

async function persistCollectedResults(
  input: CollectorWorkerInput,
  minuteWindow: { startMs: number; endMs: number },
  cursors: Map<string, number>,
  writer: SymbolArchiveWriter,
  baseResults: EndpointCollectionResult[],
  snapshotFanoutResults: EndpointCollectionResult[],
  minuteFanoutResults: EndpointCollectionResult[]
): Promise<PersistStats> {
  const stats: PersistStats = {
    recordsWritten: 0,
    duplicateRecordsSkipped: 0,
    minutePointsProcessed: 0,
    snapshotRowsProcessed: 0
  };

  for (const result of baseResults) {
    if (!result.collected.ok) continue;
    const minuteMs = toMinuteBucketMs(Date.parse(result.collected.fetchedAt));
    const rows = extractSymbolPayloadRows(result.collected.payload);

    if (rows.length === 0) {
      stats.snapshotRowsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: GLOBAL_SYMBOL,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(minuteMs).toISOString(),
        minuteMs,
        tags: result.collected.tags,
        payload: result.collected.payload
      });
      applyPersistOutcome(stats, outcome);
      continue;
    }

    for (const row of rows) {
      stats.snapshotRowsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: row.symbol,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(minuteMs).toISOString(),
        minuteMs,
        tags: result.collected.tags,
        payload: row.payload
      });
      applyPersistOutcome(stats, outcome);
    }
  }

  for (const result of snapshotFanoutResults) {
    if (!result.collected.ok) continue;

    const minuteMs = toMinuteBucketMs(Date.parse(result.collected.fetchedAt));
    const endpointSymbol = extractSymbolFromEndpoint(result.endpoint);

    if (endpointSymbol) {
      stats.snapshotRowsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: endpointSymbol,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(minuteMs).toISOString(),
        minuteMs,
        tags: result.collected.tags,
        payload: result.collected.payload
      });
      applyPersistOutcome(stats, outcome);
      continue;
    }

    const rows = extractSymbolPayloadRows(result.collected.payload);
    if (rows.length === 0) {
      stats.snapshotRowsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: GLOBAL_SYMBOL,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(minuteMs).toISOString(),
        minuteMs,
        tags: result.collected.tags,
        payload: result.collected.payload
      });
      applyPersistOutcome(stats, outcome);
      continue;
    }

    for (const row of rows) {
      stats.snapshotRowsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: row.symbol,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(minuteMs).toISOString(),
        minuteMs,
        tags: result.collected.tags,
        payload: row.payload
      });
      applyPersistOutcome(stats, outcome);
    }
  }

  for (const result of minuteFanoutResults) {
    if (!result.collected.ok) continue;

    const symbol = extractSymbolFromEndpoint(result.endpoint);
    const points = extractMinutePoints(result.collected.payload)
      .filter((point) => point.minuteMs >= minuteWindow.startMs && point.minuteMs <= minuteWindow.endMs)
      .sort((a, b) => a.minuteMs - b.minuteMs);

    if (points.length === 0) {
      continue;
    }

    const targetSymbol = symbol ?? GLOBAL_SYMBOL;
    for (const point of points) {
      stats.minutePointsProcessed += 1;
      const outcome = await appendIfNew(cursors, writer, {
        exchange: input.exchangeName,
        symbol: targetSymbol,
        endpoint: result.endpoint.name,
        sourceUrl: result.collected.url,
        collectedAt: result.collected.fetchedAt,
        minute: new Date(point.minuteMs).toISOString(),
        minuteMs: point.minuteMs,
        tags: result.collected.tags,
        payload: point.payload
      });
      applyPersistOutcome(stats, outcome);
    }
  }

  return stats;
}

function applyPersistOutcome(stats: PersistStats, outcome: "written" | "duplicate"): void {
  if (outcome === "written") {
    stats.recordsWritten += 1;
  } else {
    stats.duplicateRecordsSkipped += 1;
  }
}

async function appendIfNew(
  cursors: Map<string, number>,
  writer: SymbolArchiveWriter,
  record: SymbolArchiveRecord
): Promise<"written" | "duplicate"> {
  const key = buildCursorKey(record.endpoint, record.symbol);
  const lastMinuteMs = cursors.get(key);

  if (typeof lastMinuteMs === "number" && record.minuteMs <= lastMinuteMs) {
    return "duplicate";
  }

  await writer.append(record);
  cursors.set(key, record.minuteMs);
  return "written";
}

function summarizeRequestStats(results: EndpointCollectionResult[]): RequestStats {
  const requestsAttempted = results.length;
  let requestsSucceeded = 0;

  for (const result of results) {
    if (result.collected.ok) {
      requestsSucceeded += 1;
    }
  }

  return {
    requestsAttempted,
    requestsSucceeded,
    requestsFailed: requestsAttempted - requestsSucceeded
  };
}
