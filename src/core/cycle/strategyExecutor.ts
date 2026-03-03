/**
 * Executes active strategies and persists outputs.
 */
import { Repositories } from "../../db/repos/index.js";
import { ExchangeAccountState, extractExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { FuturesSnapshot } from "../../exchange/types.js";
import { MessageDispatcher } from "../../notifications/messageDispatcher.js";
import { captureStrategyAccountSnapshot } from "../../services/account/captureStrategyAccountSnapshot.js";
import { ManualAlertService } from "../../services/manual/manualAlertService.js";
import { StrategyDescriptor, StrategyWorkerOutput } from "../../strategies/types.js";
import { runStrategyInWorker } from "../../strategies/worker/workerRunner.js";
import { Logger } from "../../utils/logger.js";
import { buildStrategyInput } from "./strategyInputBuilder.js";

export interface StrategyExecutorDeps {
  repos: Repositories;
  messageDispatcher: MessageDispatcher;
  manualAlertService: ManualAlertService;
  logger: Logger;
  tickerDeepLinkTemplate: string;
  liveAccountProvider?: () => Promise<ExchangeAccountState | null>;
  strictLiveAccount?: boolean;
}

interface StrategyExecutionResult {
  strategyName: string;
  output: StrategyWorkerOutput;
}

export class StrategyExecutor {
  constructor(private readonly deps: StrategyExecutorDeps) {}

  async executeAll(runId: string, snapshot: FuturesSnapshot, strategies: StrategyDescriptor[]): Promise<void> {
    const tasks = strategies.map((strategy) => this.executeOne(runId, snapshot, strategy));
    await Promise.all(tasks);
  }

  private async executeOne(
    runId: string,
    snapshot: FuturesSnapshot,
    strategy: StrategyDescriptor
  ): Promise<StrategyExecutionResult> {
    const strategyRunId = await this.deps.repos.strategies.startRun(runId, strategy.name);
    const exchangeAccount = await this.resolveExchangeAccount(snapshot);

    try {
      const [openPositions, previousAccountSnapshot] = await Promise.all([
        this.deps.repos.trades.getOpenPositionsByStrategy(strategy.name),
        this.deps.repos.equity.getLatestSnapshotByStrategy(strategy.name)
      ]);
      const input = buildStrategyInput(
        runId,
        strategy.name,
        snapshot,
        this.deps.tickerDeepLinkTemplate,
        openPositions,
        previousAccountSnapshot,
        exchangeAccount
      );
      const output = await runStrategyInWorker(strategy, input);
      await this.persistStrategyOutput(runId, strategyRunId, strategy.name, output, exchangeAccount, snapshot.collectedAt);
      await this.deps.repos.strategies.finishRun(strategyRunId, "SUCCESS");
      this.logStrategySuccess(runId, strategy.name, output);
      return { strategyName: strategy.name, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.deps.repos.strategies.finishRun(strategyRunId, "FAILED", errorMessage);
      this.deps.logger.error("strategy failed", {
        runId,
        strategy: strategy.name,
        error: errorMessage
      });
      throw error;
    }
  }

  private async resolveExchangeAccount(snapshot: FuturesSnapshot): Promise<ExchangeAccountState | null> {
    if (this.deps.liveAccountProvider) {
      const live = await this.deps.liveAccountProvider();
      if (!live && this.deps.strictLiveAccount) {
        throw new Error("Strict live account mode requires exchange account payload");
      }
      return live;
    }

    return extractExchangeAccountState(snapshot);
  }

  private async persistStrategyOutput(
    runId: string,
    strategyRunId: string,
    strategyName: string,
    output: StrategyWorkerOutput,
    exchangeAccount: ExchangeAccountState | null,
    observedAt: string
  ): Promise<void> {
    const prepared = await this.deps.manualAlertService.prepareForDispatch(runId, strategyName, output.messages);
    const delivered = await this.deps.messageDispatcher.dispatch(prepared);
    await this.deps.manualAlertService.applyDelivery(delivered);

    await this.deps.repos.strategies.insertMessages(runId, strategyRunId, strategyName, delivered);
    await this.deps.repos.strategies.upsertTrackedSymbols(strategyName, output.trackedSymbols);
    await this.deps.repos.trades.insertPositionEvents(runId, output.positionEvents);
    await this.deps.repos.trades.applyPositionState(output.positionEvents);

    if (output.accountSnapshot) {
      await this.deps.repos.equity.insert(output.accountSnapshot);
      return;
    }

    await captureStrategyAccountSnapshot({
      repos: this.deps.repos,
      strategyName,
      observedAt,
      liveAccount: exchangeAccount,
      strictLiveAccount: this.deps.strictLiveAccount === true
    });
  }

  private logStrategySuccess(runId: string, strategyName: string, output: StrategyWorkerOutput): void {
    this.deps.logger.info("strategy completed", {
      runId,
      strategy: strategyName,
      messages: output.messages.length,
      events: output.positionEvents.length
    });
  }
}
