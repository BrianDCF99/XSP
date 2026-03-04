/**
 * Collects futures data from fixed dual sources:
 * - Signal source (Bybit)
 * - Execution source (MEXC)
 */
import { RuntimeConfig } from "../config/schema.js";
import { Logger } from "../utils/logger.js";
import { nowIso } from "../utils/time.js";
import { collectEndpoint } from "./endpointCollector.js";
import { buildFanoutEndpoint } from "./fanoutEndpointBuilder.js";
import { resolveExecutionExchange, resolveSignalExchange } from "./exchangeConfigResolver.js";
import { HttpJsonClient } from "./httpJsonClient.js";
import { runWithLimit } from "./parallelLimiter.js";
import { extractSymbolUniverse } from "./symbolUniverseExtractor.js";
import { ExchangeConfig, ExchangeEndpointConfig, FuturesSnapshot } from "./types.js";

export class ExchangeCollector {
  private readonly client: HttpJsonClient;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger
  ) {
    this.client = new HttpJsonClient(cfg.exchange.requestTimeoutMs);
  }

  get tickerDeepLinkTemplate(): string {
    return resolveExecutionExchange(this.cfg).tickerDeepLinkTemplate;
  }

  get exchangeName(): string {
    return resolveExecutionExchange(this.cfg).name;
  }

  async collectFuturesData(): Promise<FuturesSnapshot> {
    const execution = resolveExecutionExchange(this.cfg);
    const signal = resolveSignalExchange(this.cfg);

    const [executionEndpoints, signalEndpoints] = await Promise.all([
      this.collectSource(execution),
      this.collectSource(signal)
    ]);

    return {
      // keep legacy top-level `exchange` as execution source for run labels and DB compatibility.
      exchange: execution.name,
      executionExchange: execution.name,
      signalExchange: signal.name,
      collectedAt: nowIso(),
      endpoints: [...executionEndpoints, ...signalEndpoints]
    };
  }

  private async collectSource(source: ExchangeConfig): Promise<FuturesSnapshot["endpoints"]> {
    const enabledEndpoints = source.futuresEndpoints.filter((endpoint) => endpoint.enabled);
    const baseEndpoints = enabledEndpoints.filter((endpoint) => !endpoint.symbolFanout);
    const fanoutTemplates = enabledEndpoints.filter((endpoint) => endpoint.symbolFanout);

    const baseResults = await this.collectMany(source.name, source.restBaseUrl, baseEndpoints);
    const symbols = extractSymbolUniverse(baseResults);
    const fanoutEndpoints = this.materializeFanoutEndpoints(source.name, fanoutTemplates, symbols);
    const fanoutResults = await this.collectMany(source.name, source.restBaseUrl, fanoutEndpoints);

    return [...baseResults, ...fanoutResults];
  }

  private materializeFanoutEndpoints(
    sourceName: string,
    templates: ExchangeEndpointConfig[],
    symbols: string[]
  ): ExchangeEndpointConfig[] {
    if (templates.length === 0) return [];
    if (symbols.length === 0) {
      this.logger.warn("symbol fanout endpoints skipped because symbol universe is empty", {
        source: sourceName,
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
      source: sourceName,
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
