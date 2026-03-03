/**
 * Types for exchange endpoint collection.
 */
export interface ExchangeEndpointConfig {
  name: string;
  method: "GET" | "POST";
  path: string;
  pathParams?: Record<string, string> | undefined;
  query?: Record<string, string> | undefined;
  symbolFanout: boolean;
  minuteBackfill: boolean;
  enabled: boolean;
  tags: string[];
}

export interface ExchangeConfig {
  name: string;
  restBaseUrl: string;
  tickerDeepLinkTemplate: string;
  futuresEndpoints: ExchangeEndpointConfig[];
  archiveEndpoints: ExchangeEndpointConfig[];
}

export interface CollectedEndpoint {
  name: string;
  method: "GET" | "POST";
  url: string;
  tags: string[];
  fetchedAt: string;
  latencyMs: number;
  ok: boolean;
  statusCode: number;
  payload: unknown;
  error: string | null;
}

export interface FuturesSnapshot {
  exchange: string;
  collectedAt: string;
  endpoints: CollectedEndpoint[];
}
