/**
 * Resolves fixed signal/execution exchange configs from runtime configuration.
 */
import { RuntimeConfig } from "../config/schema.js";
import { ExchangeConfig } from "./types.js";

function mapExchange(rawExchange: RuntimeConfig["exchange"]["signal"]): ExchangeConfig {
  return {
    name: rawExchange.name,
    restBaseUrl: rawExchange.restBaseUrl,
    tickerDeepLinkTemplate: rawExchange.tickerDeepLinkTemplate,
    futuresEndpoints: rawExchange.futuresEndpoints
  };
}

export function resolveSignalExchange(cfg: RuntimeConfig): ExchangeConfig {
  return mapExchange(cfg.exchange.signal);
}

export function resolveExecutionExchange(cfg: RuntimeConfig): ExchangeConfig {
  return mapExchange(cfg.exchange.execution);
}
