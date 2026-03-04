/**
 * XSP-specific market extraction helpers for Bybit-signal + MEXC-execution mode.
 */

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toUpperCase() : null;
}

function toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.result)) return obj.result;
  if (obj.data && typeof obj.data === "object" && Array.isArray(obj.data.list)) return obj.data.list;
  if (obj.result && typeof obj.result === "object" && Array.isArray(obj.result.list)) return obj.result.list;

  return [];
}

function toCrossKey(symbol) {
  return symbol.replaceAll("_", "").toUpperCase();
}

export function bybitToMexcSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return "";
  if (normalized.includes("_")) return normalized;

  if (normalized.endsWith("USDT")) {
    const base = normalized.slice(0, -4);
    return base.length > 0 ? `${base}_USDT` : normalized;
  }

  if (normalized.endsWith("USDC")) {
    const base = normalized.slice(0, -4);
    return base.length > 0 ? `${base}_USDC` : normalized;
  }

  return normalized;
}

export function mexcToBybitSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return "";
  return normalized.replaceAll("_", "");
}

function extractBybitTickers(snapshot) {
  const map = new Map();

  for (const endpoint of snapshot.endpoints) {
    if (String(endpoint.sourceExchange ?? "").toLowerCase() !== "bybit") continue;
    if (!String(endpoint.name).toLowerCase().includes("ticker")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row;
      const symbol = normalizeSymbol(obj.symbol ?? obj.s ?? obj.contract);
      const price = parseNumber(obj.lastPrice ?? obj.markPrice ?? obj.indexPrice ?? obj.price ?? obj.close);
      const hourVolume = parseNumber(obj.turnover24h ?? obj.volume24h ?? obj.turnover ?? obj.volume ?? obj.amount24);
      if (!symbol || price === null || hourVolume === null) continue;

      map.set(toCrossKey(symbol), {
        symbol,
        price,
        hourVolume
      });
    }
  }

  return map;
}

function extractBybitRatios(snapshot) {
  const map = new Map();

  for (const endpoint of snapshot.endpoints) {
    if (String(endpoint.sourceExchange ?? "").toLowerCase() !== "bybit") continue;
    const endpointName = String(endpoint.name).toLowerCase();
    if (!endpointName.includes("account_ratio") && !endpointName.includes("ratio")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row;
      const symbol = normalizeSymbol(obj.symbol ?? obj.s ?? obj.contract);
      const sellRatio = parseNumber(obj.sellRatio ?? obj.sell_ratio ?? obj.shortAccount ?? obj.shortRatio);
      if (!symbol || sellRatio === null) continue;

      map.set(toCrossKey(symbol), {
        symbol,
        sellRatio
      });
    }
  }

  return map;
}

export function extractMexcPriceMap(snapshot) {
  const map = new Map();

  for (const endpoint of snapshot.endpoints) {
    if (String(endpoint.sourceExchange ?? "").toLowerCase() !== "mexc") continue;
    if (!String(endpoint.name).toLowerCase().includes("ticker")) continue;

    for (const row of toRows(endpoint.payload)) {
      if (!row || typeof row !== "object") continue;
      const obj = row;
      const symbol = normalizeSymbol(obj.symbol ?? obj.contract ?? obj.s);
      const price = parseNumber(obj.lastPrice ?? obj.price ?? obj.last_price ?? obj.markPrice ?? obj.indexPrice ?? obj.close);
      if (!symbol || price === null) continue;
      map.set(symbol, price);
    }
  }

  return map;
}

export function extractBybitSignalRows(snapshot) {
  const bybitTickers = extractBybitTickers(snapshot);
  const bybitRatios = extractBybitRatios(snapshot);
  const mexcPrices = extractMexcPriceMap(snapshot);

  const rows = [];
  for (const [key, ticker] of bybitTickers) {
    const ratio = bybitRatios.get(key);
    if (!ratio) continue;

    const bybitSymbol = mexcToBybitSymbol(ticker.symbol);
    const mexcSymbol = bybitToMexcSymbol(bybitSymbol);

    rows.push({
      key,
      bybitSymbol,
      mexcSymbol,
      bybitPrice: ticker.price,
      mexcPrice: mexcPrices.get(mexcSymbol) ?? ticker.price,
      sellRatio: ratio.sellRatio,
      hourVolume: ticker.hourVolume
    });
  }

  rows.sort((a, b) => a.sellRatio - b.sellRatio);

  return {
    rows,
    bybitTickerCount: bybitTickers.size,
    bybitSellRatioCount: bybitRatios.size,
    mexcPriceBySymbol: mexcPrices
  };
}
