/**
 * Resolves manual button actions and per-alert refreshes.
 */
import { RuntimeConfig } from "../../config/schema.js";
import { ManualAlertRecord } from "../../db/repos/manualAlertRepository.js";
import { Repositories } from "../../db/repos/index.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import { extractBybitSignalRows } from "../../exchange/signalMarketExtractor.js";
import { MexcOpenPosition, MexcPrivateClient } from "../../exchange/mexc/mexcPrivateClient.js";
import { TelegramClient } from "../../notifications/telegramClient.js";
import { ManualAlertButtonAction, PositionEvent, StrategyMessage } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import {
  AccountState,
  StrategyTelegramModule,
  asNumber,
  asString,
  calcExitSlippageBps,
  calcMarginToPutRounded,
  calcRoundtripSlippageBps,
  calcShortPnlPct,
  calcShortPnlUsd,
  defaultAccountState,
  finiteNumber,
  mapExpectedEventType,
  normalizeSymbol,
  nowIso,
  pickBestHistoryPosition,
  positiveFiniteNumber,
  positionAge,
  resolveEmoji,
  resolveStrategyLabel,
  shortLiquidationPrice
} from "./manualActionShared.js";

interface AlertActionResult {
  resolved: boolean;
  events: PositionEvent[];
  messages: StrategyMessage[];
  waitingSymbol?: string;
  waitingReason?: string;
}

interface ManualAlertActionResolverDeps {
  cfg: RuntimeConfig;
  repos: Repositories;
  collector: ExchangeCollector;
  mexc: MexcPrivateClient;
  telegram: TelegramClient;
  logger: Logger;
  getModule: (strategyName: string) => Promise<StrategyTelegramModule>;
  publish: (strategyName: string, messages: StrategyMessage[], events: PositionEvent[], exchangeRunLabel: string) => Promise<void>;
  fetchLiveExchangeAccountState: () => Promise<ExchangeAccountState | null>;
}

export class ManualAlertActionResolver {
  constructor(private readonly deps: ManualAlertActionResolverDeps) {}

  async resolveAlertAction(alert: ManualAlertRecord, action: ManualAlertButtonAction, sendWaitingNotice: boolean): Promise<void> {
    const module = await this.deps.getModule(alert.strategyName);

    try {
      if (alert.kind === "ENTRY_AVAILABLE" && action === "OPENED") {
        const result = await this.resolveEntryAlert(alert, module);
        await this.finalizeResult(alert, action, result, sendWaitingNotice);
        return;
      }

      if (alert.kind === "EXIT_AVAILABLE" && action === "CLOSED") {
        const result = await this.resolveExitAlert(alert, module);
        await this.finalizeResult(alert, action, result, sendWaitingNotice);
        return;
      }

      if (alert.kind === "REPLACEMENT_AVAILABLE" && action === "OPENED") {
        const result = await this.resolveReplacementAlert(alert, module);
        await this.finalizeResult(alert, action, result, sendWaitingNotice);
        return;
      }

      if (alert.kind === "ENTRY_TRACK_DECISION" && action === "TRACK") {
        const result = await this.resolveTrackDecisionAlert(alert, module);
        await this.finalizeResult(alert, action, result, sendWaitingNotice);
        return;
      }

      if (alert.kind === "ENTRY_TRACK_DECISION" && action === "IGNORE") {
        await this.deps.repos.manualAlerts.markConfirmed(alert.id, action);
        return;
      }

      if ((alert.kind === "ENTRY_AVAILABLE" || alert.kind === "REPLACEMENT_AVAILABLE") && action === "DECLINE") {
        await this.deps.repos.manualAlerts.markConfirmed(alert.id, action);
        return;
      }

      await this.deps.repos.manualAlerts.markWaiting(alert.id, action, "Action not valid for this alert kind");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await this.deps.repos.manualAlerts.markWaiting(alert.id, action, text);
      await this.deps.repos.manualAlerts.incrementAttempt(alert.id, text);
      this.deps.logger.error("manual alert action failed", {
        alertId: alert.id,
        strategy: alert.strategyName,
        action,
        error: text
      });
    }
  }

  async refreshOneAlert(alert: ManualAlertRecord): Promise<void> {
    const module = await this.deps.getModule(alert.strategyName);
    const snapshot = await this.deps.collector.collectFuturesData();
    const signalSummary = extractBybitSignalRows(snapshot);
    const signalBySymbol = new Map(signalSummary.rows.map((row) => [normalizeSymbol(row.mexcSymbol), row]));
    const openPositions = await this.deps.repos.trades.getOpenPositionsByStrategy(alert.strategyName);
    const openBySymbol = new Map(openPositions.map((position) => [normalizeSymbol(position.symbol), position]));
    const payload = alert.payload;

    if (alert.kind === "ENTRY_AVAILABLE" && module.buildEntryAvailableTelegramMessage) {
      const symbol = normalizeSymbol(asString(payload.symbol, alert.primarySymbol));
      let marginToPut = asNumber(payload.marginToPut, 0);
      try {
        const account = await this.currentAccountState(alert.strategyName);
        const recomputedMargin = calcMarginToPutRounded(account.cashUsd);
        if (recomputedMargin > 0) {
          marginToPut = recomputedMargin;
        }
      } catch (error) {
        this.deps.logger.warn("entry refresh using cached margin fallback", {
          alertId: alert.id,
          strategy: alert.strategyName,
          symbol,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const row = signalBySymbol.get(symbol);
      const bybitPriceAtAlert = asNumber(row?.bybitPrice, asNumber(payload.bybitPriceAtAlert, 0));
      const mexcPriceAtAlert = asNumber(row?.mexcPrice, asNumber(payload.priceAtAlert, 0));
      const sellRatioNow = asNumber(row?.sellRatio, asNumber(payload.sellRatioNow, 0));
      const hourVolumeNow = asNumber(row?.hourVolume, asNumber(payload.hourVolumeNow, 0));
      const takeProfitUnlevered = Math.max(0, asNumber(payload.takeProfitUnlevered, 0));
      const entryFeeBps = asNumber(payload.entryFeeBps, 0);
      const entrySlippageBps = asNumber(payload.entrySlippageBps, 0);
      const adjustedTpPct = takeProfitUnlevered + (entryFeeBps + entrySlippageBps) / 10_000;
      const takeProfitEstimatePrice = mexcPriceAtAlert > 0 ? mexcPriceAtAlert * (1 - adjustedTpPct) : 0;
      const refreshedMessage: StrategyMessage = {
        type: "ENTRY",
        symbol,
        sendTelegram: true,
        text: module.buildEntryAvailableTelegramMessage({
          emoji: resolveEmoji(alert.strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(alert.strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          symbol,
          bybitPriceAtAlert,
          mexcPriceAtAlert,
          marginToPut,
          takeProfitEstimatePrice,
          currentOpenTrades: openPositions.length,
          sellRatioNow,
          hourVolumeNow
        }),
        manualAlert: {
          kind: "ENTRY_AVAILABLE",
          primarySymbol: symbol,
          bypassDeclineMute: true,
          payload: {
            ...payload,
            symbol,
            bybitPriceAtAlert,
            priceAtAlert: mexcPriceAtAlert,
            marginToPut,
            takeProfitEstimatePrice,
            sellRatioNow,
            hourVolumeNow
          },
          buttons: ["OPENED", "DECLINE", "REFRESH"]
        }
      };

      await this.deps.publish(alert.strategyName, [refreshedMessage], [], `${this.deps.collector.exchangeName}:alert_refresh`);
      return;
    }

    if (alert.kind === "EXIT_AVAILABLE" && module.buildExitAvailableTelegramMessage) {
      const symbol = normalizeSymbol(asString(payload.symbol, alert.primarySymbol));
      const position = openBySymbol.get(symbol);
      const row = signalBySymbol.get(symbol);

      if (!position) {
        return;
      }

      const leverage = asNumber(position.leverage, 5);
      const liq = shortLiquidationPrice(position.entryPrice, leverage);
      const mexcCurrentPrice = asNumber(row?.mexcPrice, asNumber(payload.currentPrice, position.entryPrice));
      const pnlPct = calcShortPnlPct(position.entryPrice, mexcCurrentPrice, leverage);
      const pnlUsd = calcShortPnlUsd(position.entryPrice, mexcCurrentPrice, position.notionalUsd, position.marginUsd, leverage);
      const bybitEntryPrice = asNumber(payload.bybitEntryPrice, position.entryPrice);
      const bybitCurrentPrice = asNumber(row?.bybitPrice, asNumber(payload.bybitCurrentPrice, bybitEntryPrice));

      const refreshedMessage: StrategyMessage = {
        type: "EXIT",
        symbol,
        sendTelegram: true,
        text: module.buildExitAvailableTelegramMessage({
          emoji: resolveEmoji(alert.strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(alert.strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          symbol,
          reason: asString(payload.reasonLabel, alert.reason ?? "Exit"),
          bybitEntryPrice,
          bybitCurrentPrice,
          entryPrice: position.entryPrice,
          pnlPct,
          pnlUsd,
          age: positionAge(position.entryTime, nowIso()),
          currentPrice: mexcCurrentPrice,
          takeProfitPrice: position.takeProfitPrice ?? 0,
          liquidationPrice: liq
        }),
        manualAlert: {
          kind: "EXIT_AVAILABLE",
          primarySymbol: symbol,
          reason: asString(payload.reasonLabel, alert.reason ?? "Exit"),
          payload: {
            ...payload,
            symbol,
            bybitEntryPrice,
            bybitCurrentPrice,
            entryPrice: position.entryPrice,
            currentPrice: mexcCurrentPrice,
            pnlPct,
            pnlUsd,
            age: positionAge(position.entryTime, nowIso()),
            takeProfitPrice: position.takeProfitPrice ?? 0,
            liquidationPrice: liq,
            leverage,
            marginUsd: position.marginUsd,
            notionalUsd: position.notionalUsd,
            qty: position.qty,
            entrySlippageBps: position.entrySlippageBps,
            entryTime: position.entryTime
          },
          buttons: ["CLOSED", "REFRESH"]
        }
      };

      await this.deps.publish(alert.strategyName, [refreshedMessage], [], `${this.deps.collector.exchangeName}:alert_refresh`);
      return;
    }

    if (alert.kind === "REPLACEMENT_AVAILABLE" && module.buildReplacementAvailableTelegramMessage) {
      const loserSymbol = normalizeSymbol(asString(payload.loserSymbol, alert.secondarySymbol ?? ""));
      const newSymbol = normalizeSymbol(asString(payload.newSymbol, alert.primarySymbol));

      const loserPosition = openBySymbol.get(loserSymbol);
      const loserRow = signalBySymbol.get(loserSymbol);
      const newRow = signalBySymbol.get(newSymbol);

      if (!loserPosition || !loserRow || !newRow) {
        return;
      }

      let marginToPut = asNumber(payload.marginToPut, 0);
      try {
        const account = await this.currentAccountState(alert.strategyName);
        const recomputedMargin = calcMarginToPutRounded(account.cashUsd);
        if (recomputedMargin > 0) {
          marginToPut = recomputedMargin;
        }
      } catch (error) {
        this.deps.logger.warn("replacement refresh using cached margin fallback", {
          alertId: alert.id,
          strategy: alert.strategyName,
          symbol: newSymbol,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const loserLeverage = asNumber(loserPosition.leverage, 5);
      const loserPnlPct = calcShortPnlPct(loserPosition.entryPrice, loserRow.mexcPrice, loserLeverage);
      const loserPnlUsd = calcShortPnlUsd(
        loserPosition.entryPrice,
        loserRow.mexcPrice,
        loserPosition.notionalUsd,
        loserPosition.marginUsd,
        loserLeverage
      );
      const loserBybitEntryPrice = asNumber(payload.loserBybitEntryPrice, loserPosition.entryPrice);
      const loserBybitCurrentPrice = asNumber(loserRow.bybitPrice, asNumber(payload.loserBybitCurrentPrice, loserBybitEntryPrice));
      const newBybitPriceAtAlert = asNumber(newRow.bybitPrice, asNumber(payload.newBybitPriceAtAlert, 0));
      const newMexcPriceAtAlert = asNumber(newRow.mexcPrice, asNumber(payload.newPriceAtAlert, 0));
      const newSellRatioNow = asNumber(newRow.sellRatio, asNumber(payload.newSellRatioNow, 0));
      const newHourVolumeNow = asNumber(newRow.hourVolume, asNumber(payload.newHourVolumeNow, 0));

      const refreshedMessage: StrategyMessage = {
        type: "ENTRY",
        symbol: newSymbol,
        sendTelegram: true,
        text: module.buildReplacementAvailableTelegramMessage({
          emoji: resolveEmoji(alert.strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(alert.strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          loserSymbol,
          loserBybitEntryPrice,
          loserBybitCurrentPrice,
          loserEntryPrice: loserPosition.entryPrice,
          loserPnlPct,
          loserPnlUsd,
          loserAge: positionAge(loserPosition.entryTime, nowIso()),
          loserCurrentPrice: loserRow.mexcPrice,
          loserTakeProfitPrice: loserPosition.takeProfitPrice ?? 0,
          loserLiquidationPrice: shortLiquidationPrice(loserPosition.entryPrice, loserLeverage),
          newSymbol,
          newBybitPriceAtAlert,
          newMexcPriceAtAlert,
          marginToPut,
          newSellRatioNow,
          newHourVolumeNow,
          currentOpenTrades: openPositions.length
        }),
        manualAlert: {
          kind: "REPLACEMENT_AVAILABLE",
          primarySymbol: newSymbol,
          secondarySymbol: loserSymbol,
          reason: "Replacement",
          bypassDeclineMute: true,
          payload: {
            ...payload,
            loserSymbol,
            newSymbol,
            loserBybitEntryPrice,
            loserBybitCurrentPrice,
            loserEntryPrice: loserPosition.entryPrice,
            loserCurrentPrice: loserRow.mexcPrice,
            loserPnlPct,
            loserPnlUsd,
            loserAge: positionAge(loserPosition.entryTime, nowIso()),
            loserTakeProfitPrice: loserPosition.takeProfitPrice ?? 0,
            loserLiquidationPrice: shortLiquidationPrice(loserPosition.entryPrice, loserLeverage),
            loserEntryTime: loserPosition.entryTime,
            loserLeverage,
            loserMarginUsd: loserPosition.marginUsd,
            loserNotionalUsd: loserPosition.notionalUsd,
            loserQty: loserPosition.qty,
            loserEntrySlippageBps: loserPosition.entrySlippageBps,
            newBybitPriceAtAlert,
            newPriceAtAlert: newMexcPriceAtAlert,
            marginToPut,
            newSellRatioNow,
            newHourVolumeNow
          },
          buttons: ["OPENED", "REFRESH"]
        }
      };

      await this.deps.publish(alert.strategyName, [refreshedMessage], [], `${this.deps.collector.exchangeName}:alert_refresh`);
    }
  }

  private async finalizeResult(
    alert: ManualAlertRecord,
    action: ManualAlertButtonAction,
    result: AlertActionResult,
    sendWaitingNotice: boolean
  ): Promise<void> {
    if (result.resolved) {
      await this.deps.publish(alert.strategyName, result.messages, result.events, `${this.deps.collector.exchangeName}:manual_action`);
      if (alert.kind === "ENTRY_TRACK_DECISION" && action === "TRACK" && result.events.length > 0) {
        const symbols = [...new Set(result.events.map((event) => event.symbol).filter((symbol) => symbol.length > 0))];
        if (symbols.length > 0) {
          await this.deps.repos.strategies.upsertTrackedSymbols(alert.strategyName, symbols);
        }
      }
      await this.deps.repos.manualAlerts.markConfirmed(alert.id, action);
      return;
    }

    await this.deps.repos.manualAlerts.markWaiting(alert.id, action, result.waitingReason);
    await this.deps.repos.manualAlerts.incrementAttempt(alert.id, result.waitingReason);

    if (!sendWaitingNotice) return;

    const module = await this.deps.getModule(alert.strategyName);
    if (!module.buildWaitingForConfirmationMessage) return;

    const waitingMessage: StrategyMessage = {
      type: "STATUS",
      symbol: result.waitingSymbol ?? alert.primarySymbol,
      sendTelegram: true,
      text: module.buildWaitingForConfirmationMessage({
        emoji: resolveEmoji(alert.strategyName, module),
        exchange: this.deps.collector.exchangeName.toUpperCase(),
        strategyLabel: resolveStrategyLabel(alert.strategyName, module),
        tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
        symbol: result.waitingSymbol ?? alert.primarySymbol,
        symbols: await this.collectWaitingSymbols(alert.strategyName, result.waitingSymbol ?? alert.primarySymbol)
      })
    };

    await this.deps.publish(alert.strategyName, [waitingMessage], [], `${this.deps.collector.exchangeName}:manual_waiting`);
  }

  private async collectWaitingSymbols(strategyName: string, fallbackSymbol: string): Promise<string[]> {
    const waiting = await this.deps.repos.manualAlerts.listWaiting(200);
    const symbols = waiting
      .filter((alert) => alert.strategyName === strategyName)
      .map((alert) => normalizeSymbol(alert.primarySymbol))
      .filter((symbol) => symbol.length > 0);

    if (symbols.length === 0) {
      return [fallbackSymbol];
    }

    const unique = [...new Set(symbols)];
    if (!unique.includes(fallbackSymbol)) {
      unique.push(fallbackSymbol);
    }

    return unique;
  }

  private async resolveTrackDecisionAlert(alert: ManualAlertRecord, module: StrategyTelegramModule): Promise<AlertActionResult> {
    const payload = alert.payload;
    const symbol = normalizeSymbol(asString(payload.symbol, alert.primarySymbol));

    const openPositions = await this.deps.mexc.getOpenPositions(symbol);
    const opened = openPositions.find(
      (position) => normalizeSymbol(position.symbol) === symbol && this.isShortOpenPosition(position)
    );

    if (!opened) {
      return {
        resolved: true,
        events: [],
        messages: []
      };
    }

    const entryPrice = asNumber(opened.openAvgPrice, asNumber(payload.entryPrice, 0));
    const leverage = asNumber(opened.leverage, asNumber(payload.leverage, 5));
    const qty = asNumber(opened.holdVol, asNumber(payload.qty, 0));
    const marginUsd = asNumber(opened.im, 0) || asNumber(opened.oim, 0) || asNumber(opened.positionMargin, asNumber(payload.marginUsd, 0));
    const notionalUsd = asNumber(opened.positionValue, marginUsd > 0 ? marginUsd * leverage : asNumber(payload.notionalUsd, 0));

    const takeProfitUnlevered = Math.max(0, asNumber(payload.takeProfitUnlevered, 0));
    const entryFeeBps = asNumber(payload.entryFeeBps, 0);
    const expectedEntrySlippageBps = asNumber(payload.entrySlippageBps, 0);
    const adjustedTpPct = takeProfitUnlevered + (entryFeeBps + expectedEntrySlippageBps) / 10_000;
    const takeProfitPrice = entryPrice * (1 - adjustedTpPct);
    const liquidationPrice = asNumber(opened.liquidatePrice, shortLiquidationPrice(entryPrice, leverage));
    const entrySellRatio = finiteNumber(payload.entrySellRatio);

    const event: PositionEvent = {
      type: "ENTRY",
      strategyName: alert.strategyName,
      symbol,
      exchange: this.deps.collector.exchangeName,
      side: "SHORT",
      eventTime: nowIso(),
      price: entryPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      reason: "manual tracked entry",
      takeProfitPrice,
      ...(entrySellRatio === null ? {} : { entrySellRatio })
    };

    const account = await this.currentAccountState(alert.strategyName);

    if (!module.buildEntryConfirmedTelegramMessage) {
      return {
        resolved: true,
        events: [event],
        messages: []
      };
    }

    const message: StrategyMessage = {
      type: "ENTRY",
      symbol,
      sendTelegram: true,
      text: module.buildEntryConfirmedTelegramMessage({
        emoji: resolveEmoji(alert.strategyName, module),
        exchange: this.deps.collector.exchangeName.toUpperCase(),
        strategyLabel: resolveStrategyLabel(alert.strategyName, module),
        tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
        symbol,
        entryPrice,
        realizedEntryPrice: entryPrice,
        takeProfitPrice,
        liquidationPrice,
        account
      })
    };

    return {
      resolved: true,
      events: [event],
      messages: [message]
    };
  }

  private async resolveEntryAlert(alert: ManualAlertRecord, module: StrategyTelegramModule): Promise<AlertActionResult> {
    const payload = alert.payload;
    const symbol = normalizeSymbol(asString(payload.symbol, alert.primarySymbol));

    const openPositions = await this.deps.mexc.getOpenPositions(symbol);
    const opened = openPositions.find(
      (position) => normalizeSymbol(position.symbol) === symbol && this.isShortOpenPosition(position)
    );

    if (!opened) {
      return {
        resolved: false,
        events: [],
        messages: [],
        waitingSymbol: symbol,
        waitingReason: "entry_fill_not_found"
      };
    }

    const entryPrice = asNumber(opened.openAvgPrice, asNumber(payload.priceAtAlert, 0));
    const leverage = asNumber(opened.leverage, asNumber(payload.leverage, 5));
    const qty = asNumber(opened.holdVol, 0);
    const marginUsd = asNumber(opened.im, 0) || asNumber(opened.oim, 0) || asNumber(opened.positionMargin, 0);
    const notionalUsd = asNumber(opened.positionValue, marginUsd * leverage || qty * entryPrice);

    const tpUnlevered = Math.max(0, asNumber(payload.takeProfitUnlevered, 0));
    const entryFeeBps = asNumber(payload.entryFeeBps, 0);
    const entrySlippageBps = asNumber(payload.entrySlippageBps, 0);
    const adjustedTpPct = tpUnlevered + (entryFeeBps + entrySlippageBps) / 10_000;
    const takeProfitPrice = entryPrice * (1 - adjustedTpPct);
    const liquidationPrice = asNumber(opened.liquidatePrice, shortLiquidationPrice(entryPrice, leverage));

    const alertPrice = asNumber(payload.priceAtAlert, entryPrice);
    const entrySlippageReal = alertPrice > 0 ? ((alertPrice - entryPrice) / alertPrice) * 10_000 : 0;
    const entrySellRatio = finiteNumber(payload.entrySellRatio);

    const event: PositionEvent = {
      type: "ENTRY",
      strategyName: alert.strategyName,
      symbol,
      exchange: this.deps.collector.exchangeName,
      side: "SHORT",
      eventTime: nowIso(),
      price: entryPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      reason: "MANUAL_OPEN_CONFIRMED",
      takeProfitPrice,
      ...(entrySellRatio === null ? {} : { entrySellRatio }),
      entrySlippageBps: entrySlippageReal
    };

    const account = await this.currentAccountState(alert.strategyName);

    if (!module.buildEntryConfirmedTelegramMessage) {
      return {
        resolved: true,
        events: [event],
        messages: []
      };
    }

    const message: StrategyMessage = {
      type: "ENTRY",
      symbol,
      sendTelegram: true,
      text: module.buildEntryConfirmedTelegramMessage({
        emoji: resolveEmoji(alert.strategyName, module),
        exchange: this.deps.collector.exchangeName.toUpperCase(),
        strategyLabel: resolveStrategyLabel(alert.strategyName, module),
        tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
        symbol,
        entryPrice: alertPrice,
        realizedEntryPrice: entryPrice,
        takeProfitPrice,
        liquidationPrice,
        entrySlippageBps: entrySlippageReal,
        account
      })
    };

    return {
      resolved: true,
      events: [event],
      messages: [message]
    };
  }

  private async resolveExitAlert(alert: ManualAlertRecord, module: StrategyTelegramModule): Promise<AlertActionResult> {
    const payload = alert.payload;
    const symbol = normalizeSymbol(asString(payload.symbol, alert.primarySymbol));

    const openPositions = await this.deps.mexc.getOpenPositions(symbol);
    const stillOpen = openPositions.find(
      (position) => normalizeSymbol(position.symbol) === symbol && this.isShortOpenPosition(position)
    );

    if (stillOpen) {
      return {
        resolved: false,
        events: [],
        messages: [],
        waitingSymbol: symbol,
        waitingReason: "exit_fill_not_found"
      };
    }

    const lookbackMs = this.deps.cfg.manualExecution.reconcileLookbackMinutes * 60_000;
    const createdAtMsRaw = Date.parse(alert.createdAt);
    const createdAtMs = Number.isFinite(createdAtMsRaw) ? createdAtMsRaw : Date.now();
    const entryTimeRaw = asString(payload.entryTime, "");
    const entryTimeMsRaw = Date.parse(entryTimeRaw);
    const entryTimeMs =
      Number.isFinite(entryTimeMsRaw) && entryTimeMsRaw > 0
        ? entryTimeMsRaw
        : null;
    const startFromAlert = Math.max(0, createdAtMs - lookbackMs);
    const entryFloorMs = entryTimeMs === null ? startFromAlert : Math.max(0, entryTimeMs - 60_000);
    const startTime = Math.min(startFromAlert, entryFloorMs);
    const endTime = Date.now();
    const history = await this.deps.mexc.getHistoryPositions({
      symbol,
      startTime,
      endTime,
      pageNum: 1,
      pageSize: 100
    });

    const candidate = pickBestHistoryPosition(history, symbol, entryFloorMs);
    if (!candidate) {
      return {
        resolved: false,
        events: [],
        messages: [],
        waitingSymbol: symbol,
        waitingReason: "history_close_not_found"
      };
    }

    const entryPrice = asNumber(candidate.openAvgPrice, asNumber(payload.entryPrice, 0));
    const exitPrice = asNumber(candidate.closeAvgPrice, asNumber(payload.currentPrice, 0));
    const leverage = asNumber(candidate.leverage, asNumber(payload.leverage, 5));
    const qty = asNumber(candidate.closeVol, asNumber(payload.qty, 0));
    const marginUsd = asNumber(candidate.im, 0) || asNumber(candidate.oim, 0) || asNumber(payload.marginUsd, 0);
    const notionalUsd = marginUsd > 0 ? marginUsd * leverage : asNumber(payload.notionalUsd, 0);

    const pnlUsdRaw = asNumber(candidate.realised, Number.NaN);
    const pnlUsdFallback = asNumber(
      candidate.closeProfitLoss,
      ((entryPrice - exitPrice) / (entryPrice || 1)) * notionalUsd
    );
    const pnlUsd = Number.isFinite(pnlUsdRaw) ? pnlUsdRaw : pnlUsdFallback;
    const pnlPct = marginUsd > 0 ? (pnlUsd / marginUsd) * 100 : calcShortPnlPct(entryPrice, exitPrice, leverage);

    const type = mapExpectedEventType(payload.expectedEventType);
    const reason = asString(payload.reasonLabel, alert.reason ?? "Exit");
    const strategyOpen = await this.deps.repos.trades.getOpenPositionsByStrategy(alert.strategyName);
    const openPosition = strategyOpen.find((position) => normalizeSymbol(position.symbol) === symbol) ?? null;
    const entrySlippageBps = finiteNumber(payload.entrySlippageBps) ?? openPosition?.entrySlippageBps ?? null;
    const takeProfitPrice = finiteNumber(payload.takeProfitPrice);
    const entrySellRatio = finiteNumber(payload.entrySellRatio);
    const expectedExitPrice = positiveFiniteNumber(payload.currentPrice);
    const exitSlippageBps = calcExitSlippageBps(expectedExitPrice, exitPrice);
    const roundtripSlippageBps = calcRoundtripSlippageBps(entrySlippageBps, exitSlippageBps);
    const entryTimeIso = asString(payload.entryTime, openPosition?.entryTime ?? "");
    const closedAge = entryTimeIso.length > 0 ? positionAge(entryTimeIso, nowIso()) : undefined;
    const entryUsd =
      Number.isFinite(notionalUsd) && notionalUsd > 0
        ? notionalUsd
        : Number.isFinite(qty) && qty > 0 && Number.isFinite(entryPrice) && entryPrice > 0
          ? qty * entryPrice
          : 0;
    const exitUsd =
      Number.isFinite(qty) && qty > 0 && Number.isFinite(exitPrice) && exitPrice > 0
        ? qty * exitPrice
        : entryUsd;

    const event: PositionEvent = {
      type,
      strategyName: alert.strategyName,
      symbol,
      exchange: this.deps.collector.exchangeName,
      side: "SHORT",
      eventTime: nowIso(),
      price: exitPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      pnlPct,
      pnlUsd,
      reason,
      fundingUsd: asNumber(candidate.fundingFee, 0),
      ...(takeProfitPrice === null ? {} : { takeProfitPrice }),
      ...(entrySellRatio === null ? {} : { entrySellRatio }),
      ...(entrySlippageBps === null ? {} : { entrySlippageBps }),
      ...(typeof exitSlippageBps === "number" ? { exitSlippageBps } : {}),
      ...(typeof roundtripSlippageBps === "number" ? { roundtripSlippageBps } : {})
    };

    const account = await this.currentAccountState(alert.strategyName);

    if (!module.buildExitConfirmedTelegramMessage) {
      return {
        resolved: true,
        events: [event],
        messages: []
      };
    }

    const message: StrategyMessage = {
      type: "EXIT",
      symbol,
      sendTelegram: true,
      text: module.buildExitConfirmedTelegramMessage({
        emoji: resolveEmoji(alert.strategyName, module),
        exchange: this.deps.collector.exchangeName.toUpperCase(),
        strategyLabel: resolveStrategyLabel(alert.strategyName, module),
        tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
        symbol,
        reason,
        ...(typeof closedAge === "string" ? { age: closedAge } : {}),
        entryUsd,
        exitUsd,
        pnlUsd,
        pnlPct,
        ...(typeof exitSlippageBps === "number" ? { exitSlippageBps } : {}),
        ...(typeof roundtripSlippageBps === "number" ? { roundtripSlippageBps } : {}),
        fundingUsd: asNumber(candidate.fundingFee, 0),
        account
      })
    };

    return {
      resolved: true,
      events: [event],
      messages: [message]
    };
  }

  private async resolveReplacementAlert(alert: ManualAlertRecord, module: StrategyTelegramModule): Promise<AlertActionResult> {
    const payload = alert.payload;

    const loserSymbol = normalizeSymbol(asString(payload.loserSymbol, alert.secondarySymbol ?? ""));
    const newSymbol = normalizeSymbol(asString(payload.newSymbol, alert.primarySymbol));
    if (!loserSymbol || !newSymbol) {
      return {
        resolved: false,
        events: [],
        messages: [],
        waitingSymbol: alert.primarySymbol,
        waitingReason: "replacement_payload_invalid"
      };
    }

    const closePayload = {
      symbol: loserSymbol,
      reasonLabel: "Replacement",
      expectedEventType: "REPLACE",
      entryPrice: payload.loserEntryPrice,
      currentPrice: payload.loserCurrentPrice,
      leverage: payload.loserLeverage,
      marginUsd: payload.loserMarginUsd,
      notionalUsd: payload.loserNotionalUsd,
      qty: payload.loserQty,
      takeProfitPrice: payload.loserTakeProfitPrice,
      entrySlippageBps: payload.loserEntrySlippageBps ?? payload.entrySlippageBps,
      entrySellRatio: payload.entrySellRatio
    };

    const entryPayload = {
      symbol: newSymbol,
      priceAtAlert: payload.newPriceAtAlert,
      leverage: payload.leverage,
      takeProfitUnlevered: payload.takeProfitUnlevered,
      entryFeeBps: payload.entryFeeBps,
      entrySlippageBps: payload.entrySlippageBps,
      exitFeeBps: payload.exitFeeBps,
      exitSlippageBps: payload.exitSlippageBps,
      entrySellRatio: payload.entrySellRatio
    };

    const closeResult = await this.resolveExitAlert(
      {
        ...alert,
        primarySymbol: loserSymbol,
        payload: closePayload,
        reason: "Replacement"
      },
      module
    );

    if (!closeResult.resolved) {
      return {
        ...closeResult,
        waitingSymbol: loserSymbol
      };
    }

    const entryResult = await this.resolveEntryAlert(
      {
        ...alert,
        primarySymbol: newSymbol,
        payload: entryPayload
      },
      module
    );

    if (!entryResult.resolved) {
      return {
        ...entryResult,
        waitingSymbol: newSymbol
      };
    }

    return {
      resolved: true,
      events: [...closeResult.events, ...entryResult.events],
      messages: [...closeResult.messages, ...entryResult.messages]
    };
  }

  private isShortOpenPosition(position: MexcOpenPosition): boolean {
    return asNumber(position.positionType, 2) === 2 && asNumber(position.holdVol, 0) > 0;
  }

  private async currentAccountState(strategyName: string): Promise<AccountState> {
    const [live, stats] = await Promise.all([
      this.deps.fetchLiveExchangeAccountState(),
      this.deps.repos.trades.getStrategyPositionStats(strategyName)
    ]);
    const netFundingUsd = Number.isFinite(stats.netFundingUsd) ? Number(stats.netFundingUsd) : 0;
    const strictLiveAccount = this.deps.cfg.manualExecution.enabled && this.deps.collector.exchangeName.toLowerCase() === "mexc";
    if (!live) {
      if (strictLiveAccount) {
        throw new Error("Manual alert processing requires live MEXC account source-of-truth");
      }
      return {
        ...defaultAccountState(),
        netFundingUsd
      };
    }

    const equityUsd = finiteNumber(live.equityUsd);
    const cashUsd = finiteNumber(live.cashUsd);
    const marginInUseUsd = finiteNumber(live.marginInUseUsd);
    const openNotionalUsd = finiteNumber(live.openNotionalUsd);
    const unrealizedPnlUsd = finiteNumber(live.unrealizedPnlUsd);

    if (
      strictLiveAccount &&
      (equityUsd === null || cashUsd === null || marginInUseUsd === null || openNotionalUsd === null || unrealizedPnlUsd === null)
    ) {
      throw new Error("Manual alert processing requires direct exchange equity/cash/margin/notional/unrealized fields");
    }

    return {
      equityUsd: equityUsd ?? 0,
      cashUsd: cashUsd ?? 0,
      marginInUseUsd: marginInUseUsd ?? 0,
      openNotionalUsd: openNotionalUsd ?? 0,
      unrealizedPnlUsd: unrealizedPnlUsd ?? 0,
      netFundingUsd
    };
  }
}
