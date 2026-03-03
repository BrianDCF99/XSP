/**
 * Orchestrates one full cycle with small delegated responsibilities.
 */
import { RuntimeConfig } from "../config/schema.js";
import { Repositories } from "../db/repos/index.js";
import { ExchangeAccountState } from "../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../exchange/exchangeCollector.js";
import { MessageDispatcher } from "../notifications/messageDispatcher.js";
import { ManualAlertService } from "../services/manual/manualAlertService.js";
import { StrategyDescriptor } from "../strategies/types.js";
import { Logger } from "../utils/logger.js";
import { CycleGate } from "./cycle/cycleGate.js";
import { StrategyExecutor } from "./cycle/strategyExecutor.js";

export class CycleRunner {
  private readonly gate = new CycleGate();
  private readonly strategyExecutor: StrategyExecutor;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger,
    private readonly collector: ExchangeCollector,
    private readonly repos: Repositories,
    private readonly messageDispatcher: MessageDispatcher,
    private readonly manualAlertService: ManualAlertService,
    private readonly strategies: StrategyDescriptor[],
    private readonly liveAccountProvider?: () => Promise<ExchangeAccountState | null>,
    private readonly strictLiveAccount = false
  ) {
    const executorDeps = {
      repos,
      messageDispatcher,
      manualAlertService,
      logger,
      tickerDeepLinkTemplate: collector.tickerDeepLinkTemplate,
      strictLiveAccount
    } as const;

    this.strategyExecutor = new StrategyExecutor(
      liveAccountProvider
        ? {
            ...executorDeps,
            liveAccountProvider
          }
        : executorDeps
    );
  }

  async runCycle(): Promise<void> {
    if (!this.gate.tryEnter()) {
      this.logger.warn("cycle skipped", { reason: "already_running" });
      return;
    }

    const started = Date.now();
    const runId = await this.repos.runs.create(this.collector.exchangeName);

    try {
      const snapshot = await this.collector.collectFuturesData();
      await this.strategyExecutor.executeAll(runId, snapshot, this.strategies);
      await this.repos.runs.finish(runId, "SUCCESS");

      this.logger.info("cycle completed", {
        runId,
        durationMs: Date.now() - started,
        endpoints: snapshot.endpoints.length,
        strategies: this.strategies.length,
        scheduleUnit: this.cfg.scheduler.cadence.unit
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.repos.runs.finish(runId, "FAILED", errorMessage);
      this.logger.error("cycle failed", {
        runId,
        error: errorMessage,
        durationMs: Date.now() - started
      });
    } finally {
      this.gate.exit();
    }
  }
}
