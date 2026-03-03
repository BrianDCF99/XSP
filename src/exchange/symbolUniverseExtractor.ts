/**
 * Derives a symbol universe from already-fetched endpoint payloads.
 */
import { CollectedEndpoint } from "./types.js";

const SYMBOL_KEYS = new Set(["symbol", "contract", "symbolname", "displayname", "s"]);
const MAX_OBJECTS_PER_ENDPOINT = 25_000;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeSymbol(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length < 6 || trimmed.length > 32) return null;
  if (!/^[A-Z0-9_]+$/.test(trimmed)) return null;

  // Most futures symbols contain quote suffixes (USDT/USDC) or exchange underscore separators.
  if (!trimmed.includes("_") && !trimmed.endsWith("USDT") && !trimmed.endsWith("USDC")) return null;

  return trimmed;
}

function collectSymbolsFromPayload(payload: unknown): string[] {
  const queue: unknown[] = [payload];
  const symbols = new Set<string>();
  let objectCount = 0;

  while (queue.length > 0 && objectCount < MAX_OBJECTS_PER_ENDPOINT) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    if (!current || typeof current !== "object") continue;
    objectCount += 1;

    const obj = current as Record<string, unknown>;
    for (const [rawKey, rawValue] of Object.entries(obj)) {
      const key = normalizeKey(rawKey);
      if (SYMBOL_KEYS.has(key) && typeof rawValue === "string") {
        const symbol = normalizeSymbol(rawValue);
        if (symbol) symbols.add(symbol);
      }

      if (rawValue && typeof rawValue === "object") {
        queue.push(rawValue);
      }
    }
  }

  return [...symbols];
}

export function extractSymbolUniverse(endpoints: CollectedEndpoint[]): string[] {
  const symbols = new Set<string>();

  for (const endpoint of endpoints) {
    for (const symbol of collectSymbolsFromPayload(endpoint.payload)) {
      symbols.add(symbol);
    }
  }

  return [...symbols].sort();
}
