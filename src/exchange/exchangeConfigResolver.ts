/**
 * Resolves the active exchange config from runtime configuration.
 */
import { RuntimeConfig } from "../config/schema.js";
import { ExchangeConfig } from "./types.js";

export function resolveActiveExchange(cfg: RuntimeConfig): ExchangeConfig {
  const exchangeName = cfg.exchange.active;
  const rawExchange = cfg.exchange.exchanges[exchangeName];

  if (!rawExchange) {
    throw new Error(`Exchange '${exchangeName}' not found in config`);
  }

  return {
    name: exchangeName,
    restBaseUrl: rawExchange.restBaseUrl,
    tickerDeepLinkTemplate: rawExchange.tickerDeepLinkTemplate,
    futuresEndpoints: rawExchange.futuresEndpoints,
    archiveEndpoints: rawExchange.archiveEndpoints
  };
}
