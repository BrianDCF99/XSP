/**
 * Reconciles manual entry/exit/funding state against exchange history.
 */
import { RuntimeConfig } from "../../config/schema.js";
import { Repositories } from "../../db/repos/index.js";
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import { MexcOpenPosition, MexcPrivateClient } from "../../exchange/mexc/mexcPrivateClient.js";
import { BybitSignalRow, extractBybitSignalRows } from "../../exchange/signalMarketExtractor.js";
import { PositionEvent, StrategyMessage } from "../../strategies/types.js";
import {
  AccountState,
  FundingDetectedUpdate,
  RecentEntryAlertContext,
  RecentExitAlertContext,
  StrategyTelegramModule,
  asNumber,
  asString,
  calcExitSlippageBps,
  calcRoundtripSlippageBps,
  calcShortPnlPct,
  defaultAccountState,
  finiteNumber,
  fundingAmount,
  historyPositionEventTimeIso,
  isOpenPosition,
  isShortPosition,
  mapExpectedEventType,
  normalizeSymbol,
  nowIso,
  pickBestHistoryPosition,
  positionAge,
  positiveFiniteNumber,
  resolveEmoji,
  resolveStrategyLabel,
  sameFunding,
  shortLiquidationPrice
} from "./manualActionShared.js";

interface ManualRefreshReconcilerDeps {
  cfg: RuntimeConfig;
  repos: Repositories;
  collector: ExchangeCollector;
  mexc: MexcPrivateClient;
  fetchLiveExchangeAccountState: () => Promise<ExchangeAccountState | null>;
}

interface TrackDecisionState {
  allowEntry: boolean;
  message: StrategyMessage | null;
}

type SignalRowByMexcSymbol = Map<string, BybitSignalRow>;

export class ManualRefreshReconciler {
  constructor(private readonly deps: ManualRefreshReconcilerDeps) {}

  async reconcileStrategy(
    strategyName: string,
    module: StrategyTelegramModule
  ): Promise<{ messages: StrategyMessage[]; events: PositionEvent[] }> {
    const events: PositionEvent[] = [];
    const messages: StrategyMessage[] = [];

    const dbOpen = await this.deps.repos.trades.getOpenPositionsByStrategy(strategyName);
    const dbOpenMap = new Map(dbOpen.map((position) => [normalizeSymbol(position.symbol), position]));

    const mexcOpen = (await this.deps.mexc.getOpenPositions()).filter(
      (position) => isShortPosition(position) && isOpenPosition(position)
    );
    const mexcOpenMap = new Map(mexcOpen.map((position) => [normalizeSymbol(position.symbol), position]));

    const account = await this.currentAccountState(strategyName);
    let signalByMexcSymbol: SignalRowByMexcSymbol | null = null;

    for (const position of dbOpen) {
      const symbol = normalizeSymbol(position.symbol);
      if (mexcOpenMap.has(symbol)) continue;

      const exitResolved = await this.resolveManualExitFromRefresh(strategyName, symbol, position, module, account);
      if (!exitResolved) continue;

      events.push(exitResolved.event);
      messages.push(exitResolved.message);
    }

    const fundingResolved = await this.resolveFundingUpdates(strategyName, dbOpenMap, mexcOpen, module, account);
    events.push(...fundingResolved.events);
    if (fundingResolved.message) {
      messages.push(fundingResolved.message);
    }

    const tracked = new Set(
      (await this.deps.repos.strategies.getTrackedSymbols(strategyName)).map((symbol) => normalizeSymbol(symbol))
    );

    for (const mexcPosition of mexcOpen) {
      const symbol = normalizeSymbol(mexcPosition.symbol);
      if (dbOpenMap.has(symbol)) continue;

      if (!tracked.has(symbol)) {
        if (signalByMexcSymbol === null) {
          signalByMexcSymbol = await this.loadSignalRowsByMexcSymbol();
        }

        const decision = await this.resolveUntrackedSymbolDecision(
          strategyName,
          symbol,
          mexcPosition,
          module,
          signalByMexcSymbol.get(symbol) ?? null,
          dbOpen.length
        );
        if (decision.message) {
          messages.push(decision.message);
        }
        if (!decision.allowEntry) {
          continue;
        }
      }

      const entryResolved = await this.resolveManualEntryFromRefresh(strategyName, symbol, mexcPosition, module, account);
      events.push(entryResolved.event);
      messages.push(entryResolved.message);
    }

    return {
      messages,
      events
    };
  }

  private async resolveFundingUpdates(
    strategyName: string,
    dbOpenMap: Map<string, OpenPositionRecord>,
    mexcOpen: MexcOpenPosition[],
    module: StrategyTelegramModule,
    account: AccountState
  ): Promise<{ events: PositionEvent[]; message: StrategyMessage | null }> {
    const updates: FundingDetectedUpdate[] = [];

    for (const mexcPosition of mexcOpen) {
      const symbol = normalizeSymbol(mexcPosition.symbol);
      const dbPosition = dbOpenMap.get(symbol);
      if (!dbPosition) continue;

      const netFundingUsd = this.extractOpenFundingUsd(mexcPosition);
      if (netFundingUsd === null) continue;

      const previousFundingUsd = fundingAmount(dbPosition.netFundingUsd);
      if (sameFunding(netFundingUsd, previousFundingUsd)) continue;

      const fundingUsd = netFundingUsd - previousFundingUsd;
      updates.push({
        symbol,
        fundingUsd,
        netFundingUsd,
        sourcePosition: mexcPosition,
        dbPosition
      });
    }

    if (updates.length === 0) {
      return { events: [], message: null };
    }

    const eventTime = nowIso();
    const events: PositionEvent[] = updates.map((update) => {
      const leverage = asNumber(update.sourcePosition.leverage, update.dbPosition.leverage);
      const marginUsd =
        asNumber(update.sourcePosition.im, 0) ||
        asNumber(update.sourcePosition.oim, 0) ||
        asNumber(update.sourcePosition.positionMargin, 0) ||
        update.dbPosition.marginUsd;
      const notionalUsd = asNumber(
        update.sourcePosition.positionValue,
        marginUsd > 0 ? marginUsd * leverage : update.dbPosition.notionalUsd
      );
      const price = asNumber(update.sourcePosition.openAvgPrice, update.dbPosition.entryPrice);

      return {
        type: "FUNDING",
        strategyName,
        symbol: update.symbol,
        exchange: this.deps.collector.exchangeName,
        side: "SHORT",
        eventTime,
        price,
        qty: asNumber(update.sourcePosition.holdVol, update.dbPosition.qty),
        leverage,
        marginUsd,
        notionalUsd,
        reason: "FUNDING_UPDATE",
        fundingUsd: update.fundingUsd,
        ...(update.dbPosition.takeProfitPrice === null ? {} : { takeProfitPrice: update.dbPosition.takeProfitPrice }),
        ...(update.dbPosition.entrySellRatio === null ? {} : { entrySellRatio: update.dbPosition.entrySellRatio })
      };
    });

    if (!module.buildFundingTelegramMessage) {
      return { events, message: null };
    }

    const sorted = [...updates].sort((a, b) => a.symbol.localeCompare(b.symbol));
    const message: StrategyMessage = {
      type: "FUNDING",
      sendTelegram: true,
      text: module.buildFundingTelegramMessage({
        emoji: resolveEmoji(strategyName, module),
        exchange: this.deps.collector.exchangeName.toUpperCase(),
        strategyLabel: resolveStrategyLabel(strategyName, module),
        tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
        updates: sorted.map((item) => ({
          symbol: item.symbol,
          fundingUsd: item.fundingUsd,
          netFundingUsd: item.netFundingUsd
        })),
        account: {
          ...account,
          netFundingUsd: account.netFundingUsd + sorted.reduce((sum, item) => sum + item.fundingUsd, 0)
        }
      })
    };

    return { events, message };
  }

  private extractOpenFundingUsd(position: MexcOpenPosition): number | null {
    const value = position.fundingFee;
    if (!Number.isFinite(value)) return null;
    return Number(value);
  }

  private async resolveManualExitFromRefresh(
    strategyName: string,
    symbol: string,
    dbPosition: OpenPositionRecord,
    module: StrategyTelegramModule,
    account: AccountState
  ): Promise<{ event: PositionEvent; message: StrategyMessage } | null> {
    const endTime = Date.now();
    const configuredStart = endTime - this.deps.cfg.manualExecution.reconcileLookbackMinutes * 60_000;
    const entryStart = Math.max(0, Date.parse(dbPosition.entryTime) - 60_000);
    const startTime = Math.min(configuredStart, entryStart);

    const history = await this.deps.mexc.getHistoryPositions({
      symbol,
      startTime,
      endTime,
      pageNum: 1,
      pageSize: 100
    });

    const candidate = pickBestHistoryPosition(history, symbol, Date.parse(dbPosition.entryTime));
    if (!candidate) return null;

    const entryPrice = asNumber(candidate.openAvgPrice, dbPosition.entryPrice);
    const exitPrice = asNumber(candidate.closeAvgPrice, entryPrice);
    const leverage = asNumber(candidate.leverage, dbPosition.leverage);
    const qty = asNumber(candidate.closeVol, dbPosition.qty);
    const marginUsd = asNumber(candidate.im, 0) || asNumber(candidate.oim, 0) || dbPosition.marginUsd;
    const notionalUsd = marginUsd > 0 ? marginUsd * leverage : dbPosition.notionalUsd;
    const pnlUsd = Number.isFinite(candidate.realised) ? asNumber(candidate.realised, 0) : asNumber(candidate.closeProfitLoss, 0);
    const pnlPct = marginUsd > 0 ? (pnlUsd / marginUsd) * 100 : calcShortPnlPct(entryPrice, exitPrice, leverage);
    const recentExitContext = await this.resolveRecentExitAlertContext(strategyName, symbol);
    const eventType = recentExitContext.type ?? "EXIT";
    const reason = recentExitContext.reason ?? "manual exit";
    const entrySlippageBps = recentExitContext.entrySlippageBps ?? dbPosition.entrySlippageBps ?? null;
    const exitSlippageBps = calcExitSlippageBps(recentExitContext.expectedExitPrice, exitPrice);
    const roundtripSlippageBps = calcRoundtripSlippageBps(entrySlippageBps, exitSlippageBps);
    const closeEventTime = historyPositionEventTimeIso(candidate, nowIso());
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
      type: eventType,
      strategyName,
      symbol,
      exchange: this.deps.collector.exchangeName,
      side: "SHORT",
      eventTime: closeEventTime,
      price: exitPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      pnlPct,
      pnlUsd,
      reason,
      fundingUsd: asNumber(candidate.fundingFee, 0),
      ...(entrySlippageBps === null ? {} : { entrySlippageBps }),
      ...(typeof exitSlippageBps === "number" ? { exitSlippageBps } : {}),
      ...(typeof roundtripSlippageBps === "number" ? { roundtripSlippageBps } : {}),
      ...(dbPosition.takeProfitPrice === null ? {} : { takeProfitPrice: dbPosition.takeProfitPrice }),
      ...(dbPosition.entrySellRatio === null ? {} : { entrySellRatio: dbPosition.entrySellRatio })
    };

    const text = module.buildExitConfirmedTelegramMessage
      ? module.buildExitConfirmedTelegramMessage({
          emoji: resolveEmoji(strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          symbol,
          reason,
          age: positionAge(dbPosition.entryTime, closeEventTime),
          entryUsd,
          exitUsd,
          pnlUsd,
          pnlPct,
          ...(typeof entrySlippageBps === "number" ? { entrySlippageBps } : {}),
          ...(typeof exitSlippageBps === "number" ? { exitSlippageBps } : {}),
          ...(typeof roundtripSlippageBps === "number" ? { roundtripSlippageBps } : {}),
          fundingUsd: asNumber(candidate.fundingFee, 0),
          account
        })
      : `${symbol} ${reason} confirmed`;

    return {
      event,
      message: {
        type: "EXIT",
        symbol,
        sendTelegram: true,
        text
      }
    };
  }

  private async resolveManualEntryFromRefresh(
    strategyName: string,
    symbol: string,
    mexcPosition: MexcOpenPosition,
    module: StrategyTelegramModule,
    account: AccountState
  ): Promise<{ event: PositionEvent; message: StrategyMessage }> {
    const entryPrice = asNumber(mexcPosition.openAvgPrice, 0);
    const leverage = asNumber(mexcPosition.leverage, 5);
    const qty = asNumber(mexcPosition.holdVol, 0);
    const marginUsd = asNumber(mexcPosition.im, 0) || asNumber(mexcPosition.oim, 0) || asNumber(mexcPosition.positionMargin, 0);
    const notionalUsd = asNumber(mexcPosition.positionValue, marginUsd * leverage);

    const entryContext = await this.resolveRecentEntryAlertContext(strategyName, symbol, entryPrice);
    const takeProfitPrice = entryContext.takeProfitPrice;
    const liquidationPrice = asNumber(mexcPosition.liquidatePrice, shortLiquidationPrice(entryPrice, leverage));

    const event: PositionEvent = {
      type: "ENTRY",
      strategyName,
      symbol,
      exchange: this.deps.collector.exchangeName,
      side: "SHORT",
      eventTime: nowIso(),
      price: entryPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      reason: "manual entry",
      ...(takeProfitPrice === null ? {} : { takeProfitPrice }),
      ...(entryContext.entrySellRatio === null ? {} : { entrySellRatio: entryContext.entrySellRatio }),
      ...(entryContext.entrySlippageBps === null ? {} : { entrySlippageBps: entryContext.entrySlippageBps })
    };

    const text = module.buildEntryConfirmedTelegramMessage
      ? module.buildEntryConfirmedTelegramMessage({
          emoji: resolveEmoji(strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          symbol,
          entryPrice,
          realizedEntryPrice: entryPrice,
          ...(takeProfitPrice === null ? {} : { takeProfitPrice }),
          liquidationPrice,
          ...(entryContext.entrySlippageBps === null ? {} : { entrySlippageBps: entryContext.entrySlippageBps }),
          account
        })
      : `${symbol} manual entry confirmed`;

    return {
      event,
      message: {
        type: "ENTRY",
        symbol,
        sendTelegram: true,
        text
      }
    };
  }

  private async resolveRecentExitAlertContext(strategyName: string, symbol: string): Promise<RecentExitAlertContext> {
    const recentAlerts = await this.deps.repos.manualAlerts.listRecentByStrategy(
      strategyName,
      this.deps.cfg.manualExecution.reconcileLookbackMinutes
    );
    const targetSymbol = normalizeSymbol(symbol);

    for (const alert of recentAlerts) {
      if (alert.kind === "EXIT_AVAILABLE" && normalizeSymbol(alert.primarySymbol) === targetSymbol) {
        const reasonText = asString(alert.payload.reasonLabel, alert.reason ?? "");
        return {
          type: mapExpectedEventType(alert.payload.expectedEventType),
          reason: reasonText.length > 0 ? reasonText : null,
          expectedExitPrice: positiveFiniteNumber(alert.payload.currentPrice),
          entrySlippageBps: finiteNumber(alert.payload.entrySlippageBps)
        };
      }

      if (alert.kind === "REPLACEMENT_AVAILABLE" && normalizeSymbol(alert.secondarySymbol ?? "") === targetSymbol) {
        return {
          type: "REPLACE",
          reason: "Replacement",
          expectedExitPrice: positiveFiniteNumber(alert.payload.loserCurrentPrice),
          entrySlippageBps: finiteNumber(alert.payload.loserEntrySlippageBps ?? alert.payload.entrySlippageBps)
        };
      }
    }

    return {
      type: null,
      reason: null,
      expectedExitPrice: null,
      entrySlippageBps: null
    };
  }

  private async resolveRecentEntryAlertContext(
    strategyName: string,
    symbol: string,
    entryPrice: number
  ): Promise<RecentEntryAlertContext> {
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return {
        takeProfitPrice: null,
        entrySlippageBps: null,
        entrySellRatio: null
      };
    }

    const recentAlerts = await this.deps.repos.manualAlerts.listRecentByStrategy(
      strategyName,
      this.deps.cfg.manualExecution.reconcileLookbackMinutes
    );
    const targetSymbol = normalizeSymbol(symbol);

    for (const alert of recentAlerts) {
      if (alert.kind !== "ENTRY_AVAILABLE" && alert.kind !== "REPLACEMENT_AVAILABLE" && alert.kind !== "ENTRY_TRACK_DECISION")
        continue;
      if (normalizeSymbol(alert.primarySymbol) !== targetSymbol) continue;

      const takeProfitUnlevered = finiteNumber(alert.payload.takeProfitUnlevered);
      if (takeProfitUnlevered === null || takeProfitUnlevered < 0) {
        continue;
      }

      const entryFeeBps = finiteNumber(alert.payload.entryFeeBps) ?? 0;
      const expectedEntrySlippageBps = finiteNumber(alert.payload.entrySlippageBps) ?? 0;
      const takeProfitPrice = entryPrice * (1 - (takeProfitUnlevered + (entryFeeBps + expectedEntrySlippageBps) / 10_000));

      const alertPrice = positiveFiniteNumber(alert.payload.priceAtAlert ?? alert.payload.newPriceAtAlert ?? alert.payload.entryPrice);
      const entrySlippageBps = alertPrice === null ? null : ((alertPrice - entryPrice) / alertPrice) * 10_000;

      return {
        takeProfitPrice,
        entrySlippageBps,
        entrySellRatio: finiteNumber(alert.payload.entrySellRatio)
      };
    }

    return {
      takeProfitPrice: null,
      entrySlippageBps: null,
      entrySellRatio: null
    };
  }

  private async resolveUntrackedSymbolDecision(
    strategyName: string,
    symbol: string,
    mexcPosition: MexcOpenPosition,
    module: StrategyTelegramModule,
    signal: BybitSignalRow | null,
    currentOpenTrades: number
  ): Promise<TrackDecisionState> {
    const latest = await this.deps.repos.manualAlerts.getLatestByKindAndSymbol(strategyName, "ENTRY_TRACK_DECISION", symbol);
    if (latest) {
      if (latest.status !== "CONFIRMED") {
        return { allowEntry: false, message: null };
      }

      if (latest.requestedAction === "IGNORE") {
        return { allowEntry: false, message: null };
      }

      if (latest.requestedAction === "TRACK") {
        return { allowEntry: true, message: null };
      }
    }

    const entryPrice = asNumber(mexcPosition.openAvgPrice, 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return { allowEntry: false, message: null };
    }

    const leverage = asNumber(mexcPosition.leverage, 5);
    const qty = asNumber(mexcPosition.holdVol, 0);
    const marginUsd = asNumber(mexcPosition.im, 0) || asNumber(mexcPosition.oim, 0) || asNumber(mexcPosition.positionMargin, 0);
    const notionalUsd = asNumber(mexcPosition.positionValue, marginUsd * leverage);

    const defaults = module.ENTRY_TRACK_DEFAULTS ?? {};
    const takeProfitUnlevered = asNumber(defaults.takeProfitUnlevered, 0);
    const entryFeeBps = asNumber(defaults.entryFeeBps, 0);
    const entrySlippageBps = asNumber(defaults.entrySlippageBps, 0);
    const adjustedTpPct = takeProfitUnlevered + (entryFeeBps + entrySlippageBps) / 10_000;
    const takeProfitPrice = entryPrice * (1 - adjustedTpPct);
    const liquidationPrice = asNumber(mexcPosition.liquidatePrice, shortLiquidationPrice(entryPrice, leverage));

    const text = module.buildTrackDecisionTelegramMessage
      ? module.buildTrackDecisionTelegramMessage({
          emoji: resolveEmoji(strategyName, module),
          exchange: this.deps.collector.exchangeName.toUpperCase(),
          strategyLabel: resolveStrategyLabel(strategyName, module),
          tickerDeepLinkTemplate: this.deps.collector.tickerDeepLinkTemplate,
          symbol,
          entryPrice,
          takeProfitPrice,
          liquidationPrice,
          sellRatioMax: 0.2,
          minHourVolume: 1_000_000,
          concurrentCap: 15,
          sellRatioNow: signal?.sellRatio,
          hourVolumeNow: signal?.hourVolume,
          currentOpenTrades
        })
      : `${symbol} detected on exchange but not tracked. Track it in strategy?`;

    const message: StrategyMessage = {
      type: "ENTRY",
      symbol,
      sendTelegram: true,
      text,
      manualAlert: {
        kind: "ENTRY_TRACK_DECISION",
        primarySymbol: symbol,
        reason: "External position detected",
        payload: {
          symbol,
          entryPrice,
          leverage,
          qty,
          marginUsd,
          notionalUsd,
          takeProfitUnlevered,
          entryFeeBps,
          entrySlippageBps,
          takeProfitPrice,
          liquidationPrice,
          sellRatioNow: signal?.sellRatio ?? null,
          hourVolumeNow: signal?.hourVolume ?? null,
          currentOpenTrades
        },
        buttons: ["TRACK", "IGNORE"]
      }
    };

    return { allowEntry: false, message };
  }

  private async loadSignalRowsByMexcSymbol(): Promise<SignalRowByMexcSymbol> {
    try {
      const snapshot = await this.deps.collector.collectFuturesData();
      const summary = extractBybitSignalRows(snapshot);
      return new Map(summary.rows.map((row) => [normalizeSymbol(row.mexcSymbol), row]));
    } catch {
      return new Map();
    }
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
        throw new Error("Manual refresh requires live MEXC account source-of-truth");
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
      throw new Error("Manual refresh requires direct exchange equity/cash/margin/notional/unrealized fields");
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
