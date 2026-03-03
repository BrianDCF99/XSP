/**
 * Extracts minute-level points from kline-like endpoint payloads.
 */
import { MinutePoint } from "../types.js";
import { toMinuteBucketMs } from "../planning/minuteWindow.js";

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toEpochMs(value: unknown): number | null {
  const raw = toNumber(value);
  if (raw === null || raw <= 0) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function parseObjectArray(payload: unknown): MinutePoint[] {
  const rows = toRowArray(payload);
  if (rows.length === 0) return [];

  const out = new Map<number, unknown>();
  for (const row of rows) {
    const ts =
      toEpochMs(row.time) ??
      toEpochMs(row.timestamp) ??
      toEpochMs(row.ts) ??
      toEpochMs(row.t) ??
      toEpochMs(row.createTime) ??
      toEpochMs(row.create_time);

    if (ts === null) continue;
    out.set(toMinuteBucketMs(ts), row);
  }

  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minuteMs, row]) => ({ minuteMs, payload: row }));
}

function parseColumnSeries(payload: unknown): MinutePoint[] {
  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  const dataObj =
    (root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null) ??
    (root.result && typeof root.result === "object" ? (root.result as Record<string, unknown>) : null);

  if (!dataObj) return [];

  const time = Array.isArray(dataObj.time) ? dataObj.time : null;
  if (!time) return [];

  const open = Array.isArray(dataObj.open) ? dataObj.open : [];
  const high = Array.isArray(dataObj.high) ? dataObj.high : [];
  const low = Array.isArray(dataObj.low) ? dataObj.low : [];
  const close = Array.isArray(dataObj.close) ? dataObj.close : [];
  const vol = Array.isArray(dataObj.vol) ? dataObj.vol : [];
  const amount = Array.isArray(dataObj.amount) ? dataObj.amount : [];

  const out = new Map<number, unknown>();
  for (let i = 0; i < time.length; i += 1) {
    const ts = toEpochMs(time[i]);
    if (ts === null) continue;

    const minuteMs = toMinuteBucketMs(ts);
    out.set(minuteMs, {
      time: minuteMs,
      open: toNumber(open[i]),
      high: toNumber(high[i]),
      low: toNumber(low[i]),
      close: toNumber(close[i]),
      volume: toNumber(vol[i]),
      turnover: toNumber(amount[i])
    });
  }

  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minuteMs, row]) => ({ minuteMs, payload: row }));
}

function toRowArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }

  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) {
    return obj.data.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }

  if (Array.isArray(obj.result)) {
    return obj.result.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }

  const dataObj = obj.data as Record<string, unknown> | undefined;
  if (dataObj && Array.isArray(dataObj.list)) {
    return dataObj.list.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }

  const resultObj = obj.result as Record<string, unknown> | undefined;
  if (resultObj && Array.isArray(resultObj.list)) {
    return resultObj.list.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
  }

  return [];
}

export function extractMinutePoints(payload: unknown): MinutePoint[] {
  const fromColumns = parseColumnSeries(payload);
  if (fromColumns.length > 0) return fromColumns;
  return parseObjectArray(payload);
}
