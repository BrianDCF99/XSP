/**
 * Extracts cross-exchange market views for strategy execution.
 */
import { FuturesSnapshot } from "./types.js";
import { bybitToMexcSymbol, mexcToBybitSymbol, toCrossExchangeKey } from "./symbolBridge.js";

export interface BybitSignalRow {
  bybitSymbol: string;
  mexcSymbol: string;
  bybitPrice: number;
  mexcPrice: number;
  sellRatio: number;
  hourVolume: number;
}

function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asSymbol(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toUpperCase() : null;
}

function toRows(payload: unknown): unknown[] {
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

function extractBybitTickers(snapshot: FuturesSnapshot): Map<string, { symbol: string; price: number; hourVolume: number }> {
  const map = new Map<string, { symbol: string; price: number; hourVolume: number }>();

  for (const endpoint of snapshot.endpoints) {
    if (endpoint.sourceExchange.toLowerCase() !== "bybit") continue;
    if (!endpoint.name.toLowerCase().includes("ticker")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const symbol = asSymbol(obj.symbol ?? obj.s ?? obj.contract);
      const price = parseNumber(obj.lastPrice ?? obj.markPrice ?? obj.indexPrice ?? obj.price ?? obj.close);
      const hourVolume = parseNumber(obj.turnover24h ?? obj.volume24h ?? obj.turnover ?? obj.volume ?? obj.amount24);
      if (!symbol || price === null || hourVolume === null) continue;

      map.set(toCrossExchangeKey(symbol), {
        symbol,
        price,
        hourVolume
      });
    }
  }

  return map;
}

function extractBybitSellRatios(snapshot: FuturesSnapshot): Map<string, { symbol: string; sellRatio: number }> {
  const map = new Map<string, { symbol: string; sellRatio: number }>();

  for (const endpoint of snapshot.endpoints) {
    if (endpoint.sourceExchange.toLowerCase() !== "bybit") continue;
    const endpointName = endpoint.name.toLowerCase();
    if (!endpointName.includes("account_ratio") && !endpointName.includes("ratio")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const symbol = asSymbol(obj.symbol ?? obj.s ?? obj.contract);
      const sellRatio = parseNumber(obj.sellRatio ?? obj.sell_ratio ?? obj.shortAccount ?? obj.shortRatio);
      if (!symbol || sellRatio === null) continue;

      map.set(toCrossExchangeKey(symbol), {
        symbol,
        sellRatio
      });
    }
  }

  return map;
}

export function extractMexcPriceMap(snapshot: FuturesSnapshot): Map<string, number> {
  const map = new Map<string, number>();

  for (const endpoint of snapshot.endpoints) {
    if (endpoint.sourceExchange.toLowerCase() !== "mexc") continue;
    if (!endpoint.name.toLowerCase().includes("ticker")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row as Record<string, unknown>;
      const symbol = asSymbol(obj.symbol ?? obj.contract ?? obj.s);
      const price = parseNumber(obj.lastPrice ?? obj.price ?? obj.last_price ?? obj.markPrice ?? obj.indexPrice ?? obj.close);
      if (!symbol || price === null) continue;
      map.set(symbol, price);
    }
  }

  return map;
}

export function extractBybitPriceMapByMexcSymbol(snapshot: FuturesSnapshot): Map<string, number> {
  const tickers = extractBybitTickers(snapshot);
  const map = new Map<string, number>();

  for (const [, row] of tickers) {
    map.set(bybitToMexcSymbol(row.symbol), row.price);
  }

  return map;
}

export function extractBybitSignalRows(snapshot: FuturesSnapshot): {
  rows: BybitSignalRow[];
  bybitTickerCount: number;
  bybitSellRatioCount: number;
} {
  const bybitTickers = extractBybitTickers(snapshot);
  const bybitRatios = extractBybitSellRatios(snapshot);
  const mexcPrices = extractMexcPriceMap(snapshot);

  const rows: BybitSignalRow[] = [];

  for (const [key, ticker] of bybitTickers) {
    const ratio = bybitRatios.get(key);
    if (!ratio) continue;

    const bybitSymbol = mexcToBybitSymbol(ticker.symbol);
    const mexcSymbol = bybitToMexcSymbol(bybitSymbol);
    const mexcPrice = mexcPrices.get(mexcSymbol) ?? ticker.price;

    rows.push({
      bybitSymbol,
      mexcSymbol,
      bybitPrice: ticker.price,
      mexcPrice,
      sellRatio: ratio.sellRatio,
      hourVolume: ticker.hourVolume
    });
  }

  rows.sort((a, b) => a.sellRatio - b.sellRatio);

  return {
    rows,
    bybitTickerCount: bybitTickers.size,
    bybitSellRatioCount: bybitRatios.size
  };
}
