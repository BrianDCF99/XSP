/**
 * Extracts symbol-scoped rows from endpoint payloads.
 */
import { ExchangeEndpointConfig } from "../../exchange/types.js";
import { SymbolPayloadRow } from "../types.js";

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  if (symbol.length < 3 || symbol.length > 48) return null;
  if (!/^[A-Z0-9_]+$/.test(symbol)) return null;
  return symbol;
}

function readRowSymbol(row: Record<string, unknown>): string | null {
  const raw = row.symbol ?? row.contract ?? row.symbolName ?? row.displayName ?? row.s;
  return normalizeSymbol(raw);
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

export function extractSymbolPayloadRows(payload: unknown): SymbolPayloadRow[] {
  const rows = toRowArray(payload);
  if (rows.length === 0) return [];

  const bySymbol = new Map<string, unknown>();
  for (const row of rows) {
    const symbol = readRowSymbol(row);
    if (!symbol) continue;
    bySymbol.set(symbol, row);
  }

  return [...bySymbol.entries()].map(([symbol, rowPayload]) => ({
    symbol,
    payload: rowPayload
  }));
}

export function extractSymbolFromEndpoint(endpoint: ExchangeEndpointConfig): string | null {
  const fromPath = normalizeSymbol(endpoint.pathParams?.symbol);
  if (fromPath) return fromPath;

  const fromQuery = normalizeSymbol(endpoint.query?.symbol);
  if (fromQuery) return fromQuery;

  const pathParts = endpoint.path.split("/").filter((part) => part.length > 0);
  const lastPart = pathParts[pathParts.length - 1];
  return normalizeSymbol(lastPart);
}
