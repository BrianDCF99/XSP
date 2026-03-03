/**
 * Builds full endpoint URL from exchange base + endpoint config.
 */
import { ExchangeEndpointConfig } from "./types.js";
import { interpolatePath } from "./pathInterpolator.js";
import { addQueryParams } from "./queryAppender.js";

export function buildEndpointUrl(baseUrl: string, endpoint: ExchangeEndpointConfig): string {
  const pathWithParams = interpolatePath(endpoint.path, endpoint.pathParams);
  const url = new URL(pathWithParams, baseUrl);
  addQueryParams(url, endpoint.query);
  return url.toString();
}
