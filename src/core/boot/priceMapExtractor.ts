/**
 * Extracts latest mark/last prices by symbol from snapshot endpoints.
 */
import { FuturesSnapshot } from "../../exchange/types.js";

function toArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.result)) return obj.result;

  const dataObj = obj.data as Record<string, unknown> | undefined;
  if (dataObj && Array.isArray(dataObj.list)) return dataObj.list;

  const resultObj = obj.result as Record<string, unknown> | undefined;
  if (resultObj && Array.isArray(resultObj.list)) return resultObj.list;

  return [];
}

function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseSymbol(row: Record<string, unknown>): string | null {
  const raw = row.symbol ?? row.contract ?? row.symbolName ?? row.displayName ?? row.s;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function parsePrice(row: Record<string, unknown>): number | null {
  return parseNumber(row.lastPrice ?? row.price ?? row.last_price ?? row.markPrice ?? row.indexPrice ?? row.close);
}

export function extractPriceMap(snapshot: FuturesSnapshot): Map<string, number> {
  const priceMap = new Map<string, number>();
  const execution = snapshot.executionExchange.toLowerCase();

  for (const endpoint of snapshot.endpoints) {
    if (endpoint.sourceExchange.toLowerCase() !== execution) continue;

    const name = endpoint.name.toLowerCase();
    const isTickerLike = name.includes("ticker") || name.includes("mark") || name.includes("price");
    if (!isTickerLike) continue;

    const rows = toArray(endpoint.payload);
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const typed = row as Record<string, unknown>;
      const symbol = parseSymbol(typed);
      const price = parsePrice(typed);
      if (!symbol || price === null) continue;
      priceMap.set(symbol, price);
    }
  }

  return priceMap;
}
