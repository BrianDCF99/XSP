/**
 * Collects one endpoint payload and maps it into normalized metadata.
 */
import { nowIso } from "../utils/time.js";
import { HttpJsonClient } from "./httpJsonClient.js";
import { buildEndpointUrl } from "./urlBuilder.js";
import { CollectedEndpoint, ExchangeEndpointConfig } from "./types.js";

export interface CollectEndpointParams {
  exchangeName: string;
  restBaseUrl: string;
  endpoint: ExchangeEndpointConfig;
  client: HttpJsonClient;
  onFailure: (meta: { exchange: string; endpoint: string; statusCode: number; error: string | null }) => void;
}

export async function collectEndpoint(params: CollectEndpointParams): Promise<CollectedEndpoint> {
  const fetchedAt = nowIso();
  const url = buildEndpointUrl(params.restBaseUrl, params.endpoint);
  const result = await params.client.request(params.endpoint.method, url);

  if (!result.ok) {
    params.onFailure({
      exchange: params.exchangeName,
      endpoint: params.endpoint.name,
      statusCode: result.statusCode,
      error: result.error
    });
  }

  return {
    name: params.endpoint.name,
    method: params.endpoint.method,
    url,
    tags: params.endpoint.tags,
    fetchedAt,
    latencyMs: result.latencyMs,
    ok: result.ok,
    statusCode: result.statusCode,
    payload: result.payload,
    error: result.error
  };
}
