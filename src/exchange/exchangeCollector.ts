/**
 * Coordinates enabled futures endpoint collection for the active exchange.
 */
import { RuntimeConfig } from "../config/schema.js";
import { Logger } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { collectEndpoint } from "./endpointCollector.js";
import { buildFanoutEndpoint } from "./fanoutEndpointBuilder.js";
import { resolveActiveExchange } from "./exchangeConfigResolver.js";
import { HttpJsonClient } from "./httpJsonClient.js";
import { runWithLimit } from "./parallelLimiter.js";
import { extractSymbolUniverse } from "./symbolUniverseExtractor.js";
import { ExchangeEndpointConfig, FuturesSnapshot } from "./types.js";

export class ExchangeCollector {
  private readonly client: HttpJsonClient;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger
  ) {
    this.client = new HttpJsonClient(cfg.exchange.requestTimeoutMs);
  }

  get tickerDeepLinkTemplate(): string {
    return resolveActiveExchange(this.cfg).tickerDeepLinkTemplate;
  }

  get exchangeName(): string {
    return this.cfg.exchange.active;
  }

  async collectFuturesData(): Promise<FuturesSnapshot> {
    const exchange = resolveActiveExchange(this.cfg);
    const enabledEndpoints = exchange.futuresEndpoints.filter((endpoint) => endpoint.enabled);
    const baseEndpoints = enabledEndpoints.filter((endpoint) => !endpoint.symbolFanout);
    const fanoutTemplates = enabledEndpoints.filter((endpoint) => endpoint.symbolFanout);

    const baseResults = await this.collectMany(exchange.name, exchange.restBaseUrl, baseEndpoints);
    const symbols = extractSymbolUniverse(baseResults);
    const fanoutEndpoints = this.materializeFanoutEndpoints(fanoutTemplates, symbols);
    const fanoutResults = await this.collectMany(exchange.name, exchange.restBaseUrl, fanoutEndpoints);

    return {
      exchange: exchange.name,
      collectedAt: nowIso(),
      endpoints: [...baseResults, ...fanoutResults]
    };
  }

  private materializeFanoutEndpoints(templates: ExchangeEndpointConfig[], symbols: string[]): ExchangeEndpointConfig[] {
    if (templates.length === 0) return [];
    if (symbols.length === 0) {
      this.logger.warn("symbol fanout endpoints skipped because symbol universe is empty", {
        endpointCount: templates.length
      });
      return [];
    }

    const materialized: ExchangeEndpointConfig[] = [];
    for (const endpoint of templates) {
      for (const symbol of symbols) {
        materialized.push(buildFanoutEndpoint(endpoint, symbol));
      }
    }

    this.logger.info("symbol fanout materialized", {
      symbols: symbols.length,
      templates: templates.length,
      expandedEndpoints: materialized.length
    });

    return materialized;
  }

  private async collectMany(
    exchangeName: string,
    restBaseUrl: string,
    endpoints: ExchangeEndpointConfig[]
  ): Promise<FuturesSnapshot["endpoints"]> {
    if (endpoints.length === 0) return [];

    const tasks = endpoints.map((endpoint) => {
      return async () =>
        collectEndpoint({
          exchangeName,
          restBaseUrl,
          endpoint,
          client: this.client,
          onFailure: (meta) => {
            this.logger.warn("exchange endpoint request failed", meta);
          }
        });
    });

    return runWithLimit(tasks, this.cfg.exchange.maxParallelRequests);
  }
}
