/**
 * Extracts ticker-like rows (price, sell ratio, volume) keyed by symbol.
 */
import { FuturesSnapshot } from "../../exchange/types.js";

export interface MarketTickerRow {
  symbol: string;
  lastPrice: number;
  sellRatio: number | null;
  hourVolume: number | null;
  openInterest: number | null;
}

function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRowArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.result)) return obj.result;

  const data = obj.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.list)) return data.list;

  const result = obj.result as Record<string, unknown> | undefined;
  if (result && Array.isArray(result.list)) return result.list;

  return [];
}

function normalizeRow(row: unknown): MarketTickerRow | null {
  if (!row || typeof row !== "object") return null;

  const obj = row as Record<string, unknown>;
  const symbolRaw = obj.symbol ?? obj.contract ?? obj.symbolName ?? obj.displayName ?? obj.s;
  if (typeof symbolRaw !== "string" || symbolRaw.length === 0) return null;

  const lastPrice = parseNumber(obj.lastPrice ?? obj.price ?? obj.last_price ?? obj.markPrice ?? obj.indexPrice ?? obj.close);
  if (lastPrice === null) return null;

  const sellRatio = parseNumber(obj.sellRatio ?? obj.sell_ratio ?? obj.shortRatio ?? obj.short_ratio ?? obj.accountSellRatio);
  const hourVolume = parseNumber(
    obj.hourVolume ??
      obj.volumeUsd ??
      obj.volume ??
      obj.vol ??
      obj.turnover24h ??
      obj.quoteVolume ??
      obj.amount24
  );
  const openInterest = parseNumber(obj.openInterest ?? obj.open_interest ?? obj.holdVol);

  return {
    symbol: symbolRaw,
    lastPrice,
    sellRatio,
    hourVolume,
    openInterest
  };
}

export function extractMarketTickers(snapshot: FuturesSnapshot): Map<string, MarketTickerRow> {
  const map = new Map<string, MarketTickerRow>();

  for (const endpoint of snapshot.endpoints) {
    if (!endpoint.name.toLowerCase().includes("ticker")) continue;

    for (const row of toRowArray(endpoint.payload)) {
      const normalized = normalizeRow(row);
      if (!normalized) continue;
      map.set(normalized.symbol, normalized);
    }
  }

  return map;
}
