/**
 * Converts symbols across Bybit and MEXC formats.
 */

const QUOTE_SUFFIXES = ["USDT", "USDC"];

function normalize(raw: string): string {
  return raw.trim().toUpperCase();
}

export function mexcToBybitSymbol(symbol: string): string {
  const normalized = normalize(symbol);
  if (normalized.includes("_")) {
    return normalized.replaceAll("_", "");
  }
  return normalized;
}

export function bybitToMexcSymbol(symbol: string): string {
  const normalized = normalize(symbol);
  if (normalized.includes("_")) return normalized;

  for (const quote of QUOTE_SUFFIXES) {
    if (normalized.endsWith(quote)) {
      const base = normalized.slice(0, -quote.length);
      if (base.length > 0) {
        return `${base}_${quote}`;
      }
    }
  }

  return normalized;
}

export function toCrossExchangeKey(symbol: string): string {
  return normalize(symbol).replaceAll("_", "");
}
