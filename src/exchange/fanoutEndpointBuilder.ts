/**
 * Builds concrete endpoint configs for one symbol from a fanout endpoint template.
 */
import { ExchangeEndpointConfig } from "./types.js";

const SYMBOL_TOKEN = "{symbol}";

function replaceSymbolToken(value: string, symbol: string): string {
  if (!value.includes(SYMBOL_TOKEN)) return value;
  return value.replaceAll(SYMBOL_TOKEN, symbol);
}

function materializePathParams(
  path: string,
  pathParams: Record<string, string> | undefined,
  symbol: string
): Record<string, string> | undefined {
  const next = { ...(pathParams ?? {}) };

  for (const [key, value] of Object.entries(next)) {
    next[key] = replaceSymbolToken(value, symbol);
  }

  if (path.includes(SYMBOL_TOKEN) && (!next.symbol || next.symbol.includes(SYMBOL_TOKEN))) {
    next.symbol = symbol;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function materializeQuery(
  query: Record<string, string> | undefined,
  symbol: string,
  hasPathToken: boolean
): Record<string, string> | undefined {
  const next = { ...(query ?? {}) };

  for (const [key, value] of Object.entries(next)) {
    next[key] = replaceSymbolToken(value, symbol);
  }

  if (!hasPathToken && !Object.values(next).some((value) => value === symbol)) {
    if (!next.symbol || next.symbol.includes(SYMBOL_TOKEN)) {
      next.symbol = symbol;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function buildFanoutEndpoint(endpoint: ExchangeEndpointConfig, symbol: string): ExchangeEndpointConfig {
  const hasPathToken = endpoint.path.includes(SYMBOL_TOKEN);

  return {
    ...endpoint,
    path: replaceSymbolToken(endpoint.path, symbol),
    pathParams: materializePathParams(endpoint.path, endpoint.pathParams, symbol),
    query: materializeQuery(endpoint.query, symbol, hasPathToken)
  };
}
