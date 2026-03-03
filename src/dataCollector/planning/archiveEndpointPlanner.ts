/**
 * Plans archive endpoint execution (base + fanout + minute backfill shaping).
 */
import { buildFanoutEndpoint } from "../../exchange/fanoutEndpointBuilder.js";
import { ExchangeEndpointConfig } from "../../exchange/types.js";
import { MinuteWindow, PlannedArchiveEndpoints } from "../types.js";

export function planArchiveEndpoints(
  endpoints: ExchangeEndpointConfig[],
  symbols: string[],
  minuteWindow: MinuteWindow
): PlannedArchiveEndpoints {
  const enabled = endpoints.filter((endpoint) => endpoint.enabled);
  const baseEndpoints = enabled.filter((endpoint) => !endpoint.symbolFanout);
  const fanoutTemplates = enabled.filter((endpoint) => endpoint.symbolFanout);

  const materializedFanout: ExchangeEndpointConfig[] = [];
  for (const template of fanoutTemplates) {
    for (const symbol of symbols) {
      materializedFanout.push(buildFanoutEndpoint(template, symbol));
    }
  }

  const minuteFanoutEndpoints = materializedFanout
    .filter((endpoint) => endpoint.minuteBackfill)
    .map((endpoint) => withMinuteRange(endpoint, minuteWindow));

  const snapshotFanoutEndpoints = materializedFanout.filter((endpoint) => !endpoint.minuteBackfill);

  return {
    baseEndpoints,
    minuteFanoutEndpoints,
    snapshotFanoutEndpoints
  };
}

function withMinuteRange(endpoint: ExchangeEndpointConfig, window: MinuteWindow): ExchangeEndpointConfig {
  return {
    ...endpoint,
    query: {
      ...(endpoint.query ?? {}),
      start: String(window.startSec),
      end: String(window.endSec)
    }
  };
}
