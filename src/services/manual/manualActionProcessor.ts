/**
 * Orchestrates manual-action workflows by delegating to focused services.
 */
import { pathToFileURL } from "node:url";
import { RuntimeConfig } from "../../config/schema.js";
import { Repositories } from "../../db/repos/index.js";
import { ManualAlertRecord } from "../../db/repos/manualAlertRepository.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import { MexcPrivateClient } from "../../exchange/mexc/mexcPrivateClient.js";
import { MessageDispatcher } from "../../notifications/messageDispatcher.js";
import { TelegramClient } from "../../notifications/telegramClient.js";
import { TelegramCallbackQuery } from "../../notifications/telegramTypes.js";
import { ManualAlertButtonAction, PositionEvent, StrategyDescriptor, StrategyMessage } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import { decodeCallbackData } from "./callbackDataCodec.js";
import { ManualAlertActionResolver } from "./manualActionAlertResolver.js";
import { ManualActionPublisher } from "./manualActionPublisher.js";
import { ManualRefreshReconciler } from "./manualRefreshReconciler.js";
import { ManualAlertService } from "./manualAlertService.js";
import { StrategyTelegramModule, accountFromMexc, isOpenPosition, isShortPosition } from "./manualActionShared.js";

export class ManualActionProcessor {
  private readonly moduleByStrategy = new Map<string, StrategyTelegramModule>();
  private readonly mexc: MexcPrivateClient;
  private readonly publisher: ManualActionPublisher;
  private readonly alertResolver: ManualAlertActionResolver;
  private readonly refreshReconciler: ManualRefreshReconciler;
  private nextAutoRefreshAtMs = 0;
  private nextTakeProfitSyncAtMs = 0;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly repos: Repositories,
    private readonly collector: ExchangeCollector,
    private readonly telegram: TelegramClient,
    messageDispatcher: MessageDispatcher,
    manualAlertService: ManualAlertService,
    private readonly logger: Logger,
    private readonly strategies: StrategyDescriptor[]
  ) {
    this.mexc = new MexcPrivateClient(cfg);

    this.publisher = new ManualActionPublisher({
      repos,
      messageDispatcher,
      manualAlertService,
      logger: this.logger,
      fetchLiveExchangeAccountState: () => this.fetchLiveExchangeAccountState(),
      strictLiveAccount: cfg.manualExecution.enabled && collector.exchangeName.toLowerCase() === "mexc"
    });

    this.alertResolver = new ManualAlertActionResolver({
      cfg,
      repos,
      collector,
      mexc: this.mexc,
      telegram,
      logger: this.logger,
      getModule: (strategyName) => this.getModule(strategyName),
      publish: (strategyName, messages, events, exchangeRunLabel) =>
        this.publisher.publish(strategyName, messages, events, exchangeRunLabel),
      fetchLiveExchangeAccountState: () => this.fetchLiveExchangeAccountState()
    });

    this.refreshReconciler = new ManualRefreshReconciler({
      cfg,
      repos,
      collector,
      mexc: this.mexc,
      fetchLiveExchangeAccountState: () => this.fetchLiveExchangeAccountState()
    });

    this.nextAutoRefreshAtMs = Date.now() + cfg.manualExecution.autoRefreshMinutes * 60_000;
    this.nextTakeProfitSyncAtMs = Date.now();
  }

  async start(): Promise<void> {
    await this.loadModules();
  }

  async fetchLiveExchangeAccountState(): Promise<ExchangeAccountState | null> {
    if (this.collector.exchangeName.toLowerCase() !== "mexc") return null;

    const [open, assets] = await Promise.all([this.mexc.getOpenPositions(), this.mexc.getAccountAssets()]);
    const shortOpen = open.filter((position) => isShortPosition(position) && isOpenPosition(position));
    const account = accountFromMexc(shortOpen, assets);

    return {
      sourceEndpoint: "mexc_private_api",
      equityUsd: account.equityUsd,
      cashUsd: account.cashUsd,
      marginInUseUsd: account.marginInUseUsd,
      openNotionalUsd: account.openNotionalUsd,
      unrealizedPnlUsd: account.unrealizedPnlUsd
    };
  }

  async handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    const data = callback.data;
    if (!data) return;

    const decoded = decodeCallbackData(data);
    if (!decoded) return;

    const alert = await this.repos.manualAlerts.getById(decoded.alertId);
    if (!alert) {
      await this.telegram.answerCallbackQuery(callback.id, "Alert expired");
      return;
    }

    // Manual refresh should always be allowed as an operator override,
    // even when the original alert has already been confirmed.
    if (decoded.action === "REFRESH") {
      await this.telegram.answerCallbackQuery(callback.id);
      await this.alertResolver.refreshOneAlert(alert);
      return;
    }

    if (alert.status === "CONFIRMED") {
      await this.telegram.answerCallbackQuery(callback.id, "Already confirmed");
      return;
    }

    await this.telegram.answerCallbackQuery(callback.id);

    await this.alertResolver.resolveAlertAction(alert, decoded.action as ManualAlertButtonAction, true);
  }

  async pollWaitingAlerts(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;

    const waiting = await this.repos.manualAlerts.listWaiting(100);
    for (const alert of waiting) {
      if (!alert.requestedAction) continue;
      if (alert.requestedAction === "CLOSED" && this.shouldAutoConfirmExitAlert(alert)) continue;
      await this.alertResolver.resolveAlertAction(alert, alert.requestedAction, false);
    }
  }

  async syncTakeProfitsIfDue(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;

    const nowMs = Date.now();
    if (nowMs < this.nextTakeProfitSyncAtMs) return;
    this.nextTakeProfitSyncAtMs = nowMs + 60_000;

    for (const strategy of this.strategies) {
      try {
        await this.refreshReconciler.syncStrategyTakeProfits(strategy.name);
      } catch (error) {
        this.logger.warn("manual TP sync failed", {
          strategy: strategy.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  async pollAutoConfirmExitAlerts(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;

    const [pending, waiting] = await Promise.all([
      this.repos.manualAlerts.listPending(200),
      this.repos.manualAlerts.listWaiting(200)
    ]);
    const candidates = [...pending, ...waiting];

    for (const alert of candidates) {
      if (!this.shouldAutoConfirmExitAlert(alert)) continue;
      if (alert.status === "WAITING" && alert.requestedAction && alert.requestedAction !== "CLOSED") continue;
      await this.alertResolver.resolveAlertAction(alert, "CLOSED", false);
    }
  }

  async runAutoRefreshIfDue(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;

    const nowMs = Date.now();
    if (nowMs < this.nextAutoRefreshAtMs) return;

    this.nextAutoRefreshAtMs = nowMs + this.cfg.manualExecution.autoRefreshMinutes * 60_000;
    await this.runGlobalRefresh("auto");
  }

  async runGlobalRefresh(trigger: "manual" | "auto"): Promise<{
    strategiesUpdated: number;
    messageCount: number;
    eventCount: number;
  }> {
    const updates: Array<{ strategyName: string; messages: StrategyMessage[]; events: PositionEvent[] }> = [];

    for (const strategy of this.strategies) {
      const strategyName = strategy.name;
      const module = await this.getModule(strategyName);
      const refreshed = await this.refreshReconciler.reconcileStrategy(strategyName, module);
      if (refreshed.messages.length === 0 && refreshed.events.length === 0) continue;

      updates.push({
        strategyName,
        messages: refreshed.messages,
        events: refreshed.events
      });
    }

    for (const item of updates) {
      await this.publisher.publish(
        item.strategyName,
        item.messages,
        item.events,
        `${this.collector.exchangeName}:refresh:${trigger}`
      );
    }

    const messageCount = updates.reduce((sum, update) => sum + update.messages.length, 0);
    const eventCount = updates.reduce((sum, update) => sum + update.events.length, 0);

    return {
      strategiesUpdated: updates.length,
      messageCount,
      eventCount
    };
  }

  private async loadModules(): Promise<void> {
    for (const strategy of this.strategies) {
      await this.getModule(strategy.name);
    }
  }

  private async getModule(strategyName: string): Promise<StrategyTelegramModule> {
    const cached = this.moduleByStrategy.get(strategyName);
    if (cached) return cached;

    const descriptor = this.strategies.find((s) => s.name === strategyName);
    if (!descriptor) {
      throw new Error(`Strategy '${strategyName}' is not registered`);
    }

    const moduleUrl = pathToFileURL(descriptor.telegramModulePath).toString();
    const loaded = (await import(moduleUrl)) as StrategyTelegramModule;
    this.moduleByStrategy.set(strategyName, loaded);
    return loaded;
  }

  private shouldAutoConfirmExitAlert(alert: ManualAlertRecord): boolean {
    if (alert.kind !== "EXIT_AVAILABLE") return false;
    const payload = alert.payload ?? {};
    const reasonCode = String(payload.reasonCode ?? "").trim().toUpperCase();
    const expectedType = String(payload.expectedEventType ?? "").trim().toUpperCase();
    const reasonLabel = String(payload.reasonLabel ?? alert.reason ?? "").trim().toUpperCase();
    if (reasonCode === "TP" || reasonCode === "LIQUIDATION") return true;
    if (expectedType === "LIQUIDATION") return true;
    if (reasonLabel === "TAKE PROFIT" || reasonLabel === "LIQUIDATION") return true;
    return false;
  }
}
