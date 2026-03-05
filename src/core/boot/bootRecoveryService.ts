/**
 * Startup reconciler for downtime handling.
 */
import { pathToFileURL } from "node:url";
import { RuntimeConfig } from "../../config/schema.js";
import { Repositories } from "../../db/repos/index.js";
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";
import { ExchangeAccountState, extractExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import { MexcHistoryPosition, MexcOpenPosition, MexcPrivateClient } from "../../exchange/mexc/mexcPrivateClient.js";
import { extractBybitPriceMapByMexcSymbol } from "../../exchange/signalMarketExtractor.js";
import { FuturesSnapshot } from "../../exchange/types.js";
import { TelegramClient } from "../../notifications/telegramClient.js";
import { buildStatusPayload } from "../../services/telegram/statusPayloadBuilder.js";
import { accountFromMexc, positionAge } from "../../services/manual/manualActionShared.js";
import { StrategyDescriptor } from "../../strategies/types.js";
import { PositionEvent } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import { nowIso } from "../../utils/time.js";
import { buildBootCloseEvent } from "./bootEventBuilder.js";
import { evaluateBootExit } from "./bootExitEvaluator.js";
import { extractPriceMap } from "./priceMapExtractor.js";

interface BootStrategyTelegramModule {
  STRATEGY_LABEL?: string;
  STRATEGY_EMOJI?: string;
  buildStrategyStatusTelegramMessage?: (input: {
    emoji: string;
    exchange: string;
    strategyLabel: string;
    positions: Array<{
      tickerDeepLinkTemplate: string;
      symbol: string;
      entryPrice: number;
      pnlPct: number;
      pnlUsd: number;
      age: string;
      currentPrice: number;
      takeProfitPrice: number;
      liquidationPrice: number;
    }>;
    live: {
      pnlPct: number;
      pnlUsd: number;
      unrealizedPnlUsd: number;
      unrealizedPnlPct: number;
      entries: number;
      openTrades: number;
      missed: number;
      winners: number;
      losers: number;
      winPct: number;
      replaced: number;
      liquidations: number;
      equityUsd: number;
      cashUsd: number;
      marginInUseUsd: number;
      openNotionalUsd: number;
      netFundingUsd: number;
    };
  }) => string;
  buildExitConfirmedTelegramMessage?: (input: {
    emoji: string;
    exchange: string;
    strategyLabel: string;
    tickerDeepLinkTemplate: string;
    symbol: string;
    reason: string;
    age?: string;
    entryUsd?: number;
    exitUsd?: number;
    pnlUsd: number;
    pnlPct: number;
    entrySlippageBps?: number;
    exitSlippageBps?: number;
    roundtripSlippageBps?: number;
    fundingUsd: number;
    account: {
      equityUsd: number;
      cashUsd: number;
      marginInUseUsd: number;
      openNotionalUsd: number;
      unrealizedPnlUsd: number;
      netFundingUsd: number;
    };
  }) => string;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isShortPosition(position: { positionType?: number | undefined }): boolean {
  return asNumber(position.positionType, 2) === 2;
}

function isOpenPosition(position: { holdVol?: number | undefined }): boolean {
  return asNumber(position.holdVol, 0) > 0;
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function toEpochMs(value: unknown): number {
  const raw = asNumber(value, Date.now());
  if (raw <= 0) return Date.now();
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function calcShortPnlPct(entryPrice: number, exitPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  const unlevered = (entryPrice - exitPrice) / entryPrice;
  return unlevered * leverage * 100;
}

function shortLiquidationPrice(entryPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return entryPrice * (1 + 1 / leverage);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveFiniteNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || n <= 0) return null;
  return n;
}

function calcExitSlippageBps(expectedPrice: number | null, realizedPrice: number): number | undefined {
  if (expectedPrice === null) return undefined;
  if (!Number.isFinite(realizedPrice) || realizedPrice <= 0) return undefined;
  return ((realizedPrice - expectedPrice) / expectedPrice) * 10_000;
}

function calcRoundtripSlippageBps(entrySlippageBps: number | null, exitSlippageBps: number | undefined): number | undefined {
  if (entrySlippageBps === null) return undefined;
  if (typeof exitSlippageBps !== "number" || !Number.isFinite(exitSlippageBps)) return undefined;
  return entrySlippageBps + exitSlippageBps;
}

function pickBestHistoryPosition(history: MexcHistoryPosition[], symbol: string, minTimeMs: number): MexcHistoryPosition | null {
  const target = normalizeSymbol(symbol);
  const filtered = history
    .filter((row) => normalizeSymbol(row.symbol) === target)
    .filter((row) => isShortPosition(row))
    .filter((row) => asNumber(row.closeVol, 0) > 0)
    .filter((row) => toEpochMs(row.updateTime) >= minTimeMs)
    .sort((a, b) => toEpochMs(b.updateTime) - toEpochMs(a.updateTime));

  return filtered[0] ?? null;
}

interface BootExitPricingContext {
  expectedExitPrice: number | null;
  entrySlippageBps: number | null;
}

export class BootRecoveryService {
  private readonly moduleCache = new Map<string, BootStrategyTelegramModule>();
  private readonly mexcPrivate: MexcPrivateClient | null;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly repos: Repositories,
    private readonly collector: ExchangeCollector,
    private readonly telegram: TelegramClient,
    private readonly logger: Logger,
    private readonly strategies: StrategyDescriptor[]
  ) {
    this.mexcPrivate =
      cfg.manualExecution.enabled && collector.exchangeName.toLowerCase() === "mexc"
        ? new MexcPrivateClient(cfg)
        : null;
  }

  async run(): Promise<void> {
    const runId = await this.repos.runs.create(`${this.collector.exchangeName}:boot_recovery`);

    try {
      const openPositionsBefore = await this.repos.trades.getOpenPositions();
      if (openPositionsBefore.length === 0) {
        await this.repos.runs.finish(runId, "SUCCESS");
        this.logger.info("boot recovery skipped", { reason: "no_open_positions" });
        return;
      }

      const historyReconciledEvents = await this.reconcileHistoryClosedPositions(runId, openPositionsBefore);
      const openPositionsAfterHistory = await this.repos.trades.getOpenPositions();
      const snapshot = await this.collector.collectFuturesData();

      const priceMap = extractPriceMap(snapshot);
      const manualExitCandidates = this.buildReconciledEvents(openPositionsAfterHistory, priceMap);

      await this.sendBootMessages(manualExitCandidates, historyReconciledEvents, snapshot, openPositionsBefore);

      await this.repos.runs.finish(runId, "SUCCESS");
      this.logger.info("boot recovery completed", {
        runId,
        openPositions: openPositionsBefore.length,
        historyReconciled: historyReconciledEvents.length,
        manualExitCandidates: manualExitCandidates.length
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.repos.runs.finish(runId, "FAILED", errorMessage);
      this.logger.error("boot recovery failed", { runId, error: errorMessage });
    }
  }

  private buildReconciledEvents(openPositions: OpenPositionRecord[], priceMap: Map<string, number>): PositionEvent[] {
    const events: PositionEvent[] = [];
    const eventTime = nowIso();

    for (const position of openPositions) {
      const price = priceMap.get(position.symbol);
      if (!price) continue;

      const decision = evaluateBootExit(position, price);
      if (!decision.shouldClose || !decision.closeAs || !decision.reason) continue;

      events.push(buildBootCloseEvent(position, decision.closeAs, decision.reason, price, eventTime));
    }

    return events;
  }

  private async reconcileHistoryClosedPositions(runId: string, openPositions: OpenPositionRecord[]): Promise<PositionEvent[]> {
    if (!this.mexcPrivate || openPositions.length === 0) return [];

    const mexcOpen = (await this.mexcPrivate.getOpenPositions()).filter((position) => isShortPosition(position) && isOpenPosition(position));
    const liveOpenSymbols = new Set(mexcOpen.map((position) => normalizeSymbol(position.symbol)));
    const events: PositionEvent[] = [];

    for (const position of openPositions) {
      const symbol = normalizeSymbol(position.symbol);
      if (liveOpenSymbols.has(symbol)) continue;

      try {
        const history = await this.mexcPrivate.getHistoryPositions({
          symbol,
          startTime: Math.max(0, Date.parse(position.entryTime) - 60_000),
          endTime: Date.now(),
          pageNum: 1,
          pageSize: 100
        });

        const candidate = pickBestHistoryPosition(history, symbol, Date.parse(position.entryTime));
        if (!candidate) continue;

        const pricingContext = await this.resolveBootExitPricingContext(position, candidate);
        events.push(this.buildHistoryCloseEvent(position, candidate, pricingContext));
      } catch (error) {
        this.logger.warn("boot history reconciliation failed for symbol", {
          symbol,
          strategy: position.strategyName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (events.length > 0) {
      await this.repos.trades.insertPositionEvents(runId, events);
      await this.repos.trades.applyPositionState(events);
    }

    return events;
  }

  private async resolveBootExitPricingContext(
    position: OpenPositionRecord,
    candidate: MexcHistoryPosition
  ): Promise<BootExitPricingContext> {
    const symbol = normalizeSymbol(position.symbol);
    const closeTimeMs = toEpochMs(candidate.updateTime);
    const recentMinutes = Math.max(60, this.cfg.manualExecution.reconcileLookbackMinutes * 3);
    const recentAlerts = await this.repos.manualAlerts.listRecentByStrategy(position.strategyName, recentMinutes);
    const matched = recentAlerts
      .filter((alert) => alert.kind === "EXIT_AVAILABLE" && normalizeSymbol(alert.primarySymbol) === symbol)
      .map((alert) => {
        const createdAtMs = Date.parse(alert.createdAt);
        const distanceMs = Number.isFinite(createdAtMs) ? Math.abs(createdAtMs - closeTimeMs) : Number.POSITIVE_INFINITY;
        return { alert, distanceMs };
      })
      .sort((a, b) => a.distanceMs - b.distanceMs)[0]?.alert;

    if (!matched) {
      return {
        expectedExitPrice: null,
        entrySlippageBps: position.entrySlippageBps
      };
    }

    const payload = matched.payload ?? {};
    const expectedExitPrice = positiveFiniteNumber((payload as Record<string, unknown>).currentPrice);
    const entrySlippageBps = finiteNumber((payload as Record<string, unknown>).entrySlippageBps) ?? position.entrySlippageBps;

    return {
      expectedExitPrice,
      entrySlippageBps
    };
  }

  private buildHistoryCloseEvent(
    position: OpenPositionRecord,
    candidate: MexcHistoryPosition,
    pricingContext: BootExitPricingContext
  ): PositionEvent {
    const entryPrice = asNumber(candidate.openAvgPrice, position.entryPrice);
    const exitPrice = asNumber(candidate.closeAvgPrice, entryPrice);
    const leverage = asNumber(candidate.leverage, position.leverage);
    const qty = asNumber(candidate.closeVol, position.qty);
    const marginUsd = asNumber(candidate.im, 0) || asNumber(candidate.oim, 0) || position.marginUsd;
    const notionalUsd = marginUsd > 0 ? marginUsd * leverage : position.notionalUsd;

    const pnlUsdRaw = asNumber(candidate.realised, Number.NaN);
    const pnlUsdFallback = asNumber(
      candidate.closeProfitLoss,
      Number.isFinite(entryPrice) && entryPrice > 0 ? ((entryPrice - exitPrice) / entryPrice) * notionalUsd : 0
    );
    const pnlUsd = Number.isFinite(pnlUsdRaw) ? pnlUsdRaw : pnlUsdFallback;
    const pnlPct = marginUsd > 0 ? (pnlUsd / marginUsd) * 100 : calcShortPnlPct(entryPrice, exitPrice, leverage);

    const liquidationPrice = shortLiquidationPrice(position.entryPrice, position.leverage);
    const isLiq = liquidationPrice > 0 && exitPrice >= liquidationPrice;
    const isTp = position.takeProfitPrice !== null && exitPrice <= position.takeProfitPrice;

    const type: PositionEvent["type"] = isLiq ? "LIQUIDATION" : "EXIT";
    const reason = isLiq ? "Liquidation" : isTp ? "Take Profit" : "manual exit";
    const eventTime = new Date(toEpochMs(candidate.updateTime)).toISOString();
    const entrySlippageBps = pricingContext.entrySlippageBps;
    const exitSlippageBps = calcExitSlippageBps(pricingContext.expectedExitPrice, exitPrice);
    const roundtripSlippageBps = calcRoundtripSlippageBps(entrySlippageBps, exitSlippageBps);

    return {
      type,
      strategyName: position.strategyName,
      symbol: position.symbol,
      exchange: position.exchange,
      side: position.side,
      eventTime,
      price: exitPrice,
      qty,
      leverage,
      marginUsd,
      notionalUsd,
      pnlPct,
      pnlUsd,
      reason,
      fundingUsd: asNumber(candidate.fundingFee, 0),
      ...(position.takeProfitPrice === null ? {} : { takeProfitPrice: position.takeProfitPrice }),
      ...(position.entrySellRatio === null ? {} : { entrySellRatio: position.entrySellRatio }),
      ...(entrySlippageBps === null ? {} : { entrySlippageBps }),
      ...(typeof exitSlippageBps === "number" ? { exitSlippageBps } : {}),
      ...(typeof roundtripSlippageBps === "number" ? { roundtripSlippageBps } : {})
    };
  }

  private async sendBootMessages(
    manualExitCandidates: PositionEvent[],
    historyReconciledEvents: PositionEvent[],
    snapshot: FuturesSnapshot,
    openPositionsBefore: OpenPositionRecord[]
  ): Promise<void> {
    if (!this.telegram.isEnabled()) return;

    const openPositions = await this.repos.trades.getOpenPositions();
    const strategyNames = [
      ...new Set([
        ...openPositions.map((p) => p.strategyName),
        ...manualExitCandidates.map((e) => e.strategyName),
        ...historyReconciledEvents.map((e) => e.strategyName)
      ])
    ];
    const priceBySymbol = extractPriceMap(snapshot);
    const bybitPriceBySymbol = extractBybitPriceMapByMexcSymbol(snapshot);
    const liveExchangeAccount = await this.resolveBootLiveAccountState(snapshot);
    const openBeforeByStrategySymbol = new Map(
      openPositionsBefore.map((position) => [`${position.strategyName}|${normalizeSymbol(position.symbol)}`, position])
    );

    for (const strategyName of strategyNames) {
      const module = await this.loadTelegramModule(strategyName);
      if (!module) continue;

      const strategyOpen = openPositions.filter((p) => p.strategyName === strategyName);
      const [latestSnapshot, firstSnapshot] = await Promise.all([
        this.repos.equity.getLatestSnapshotByStrategy(strategyName),
        this.repos.equity.getFirstByStrategy(strategyName)
      ]);
      const startingEquityUsd = firstSnapshot?.equityUsd ?? liveExchangeAccount?.equityUsd;
      const statusInput = {
        openPositions: strategyOpen,
        latestSnapshot,
        priceBySymbol,
        bybitPriceBySymbol,
        tickerDeepLinkTemplate: this.collector.tickerDeepLinkTemplate,
        liveExchangeAccount
      };
      const statusPayload = Number.isFinite(startingEquityUsd)
        ? buildStatusPayload({
            ...statusInput,
            startingEquityUsd: Number(startingEquityUsd)
          })
        : buildStatusPayload(statusInput);

      if (module.buildExitConfirmedTelegramMessage) {
        const strategyHistoryEvents = historyReconciledEvents.filter((event) => event.strategyName === strategyName);
        for (const event of strategyHistoryEvents) {
          const key = `${strategyName}|${normalizeSymbol(event.symbol)}`;
          const openBefore = openBeforeByStrategySymbol.get(key);
          const closedAge = openBefore ? positionAge(openBefore.entryTime, event.eventTime) : undefined;
          const entryUsd = asNumber(event.notionalUsd, 0);
          const eventQty = asNumber(event.qty, 0);
          const exitUsd = eventQty > 0 ? eventQty * asNumber(event.price, 0) : entryUsd;
          const text = module.buildExitConfirmedTelegramMessage({
            emoji: this.resolveEmoji(strategyName, module),
            exchange: this.collector.exchangeName.toUpperCase(),
            strategyLabel: this.resolveStrategyLabel(strategyName, module),
            tickerDeepLinkTemplate: this.collector.tickerDeepLinkTemplate,
            symbol: event.symbol,
            reason: event.reason ?? "manual exit",
            ...(typeof closedAge === "string" ? { age: closedAge } : {}),
            ...(entryUsd > 0 ? { entryUsd } : {}),
            ...(exitUsd > 0 ? { exitUsd } : {}),
            pnlUsd: asNumber(event.pnlUsd, 0),
            pnlPct: asNumber(event.pnlPct, 0),
            ...(typeof event.entrySlippageBps === "number" ? { entrySlippageBps: event.entrySlippageBps } : {}),
            ...(typeof event.exitSlippageBps === "number" ? { exitSlippageBps: event.exitSlippageBps } : {}),
            ...(typeof event.roundtripSlippageBps === "number" ? { roundtripSlippageBps: event.roundtripSlippageBps } : {}),
            fundingUsd: asNumber(event.fundingUsd, 0),
            account: {
              equityUsd: statusPayload.live.equityUsd,
              cashUsd: statusPayload.live.cashUsd,
              marginInUseUsd: statusPayload.live.marginInUseUsd,
              openNotionalUsd: statusPayload.live.openNotionalUsd,
              unrealizedPnlUsd: statusPayload.live.unrealizedPnlUsd,
              netFundingUsd: statusPayload.live.netFundingUsd
            }
          });

          await this.telegram.sendMessage(text);
        }
      }

      if (module.buildStrategyStatusTelegramMessage) {
        const manualCandidates = manualExitCandidates.filter((event) => event.strategyName === strategyName);

        const statusText = module.buildStrategyStatusTelegramMessage({
          emoji: this.resolveEmoji(strategyName, module),
          exchange: this.collector.exchangeName.toUpperCase(),
          strategyLabel: this.resolveStrategyLabel(strategyName, module),
          positions: statusPayload.positions,
          live: statusPayload.live
        });
        await this.telegram.sendMessage(statusText);

        if (manualCandidates.length > 0) {
          const lines = manualCandidates.map((event, index) => {
            const reason = this.mapBootReason(event.reason ?? "BOOT_RECON");
            const url = this.collector.tickerDeepLinkTemplate.replaceAll("{symbol}", encodeURIComponent(event.symbol));
            return `${index + 1}. <a href="${url}"><b>${event.symbol}</b></a> | ${reason}`;
          });

          const offlineNotice = [
            `<b>${this.resolveEmoji(strategyName, module)} ${this.resolveStrategyLabel(strategyName, module)}</b>`,
            "Manual Action Required:",
            "Should Have Been Sold While Bot Was Offline:",
            "",
            ...lines
          ].join("\n");

          await this.telegram.sendMessage(offlineNotice);
        }
      }
    }
  }

  private async resolveBootLiveAccountState(snapshot: FuturesSnapshot): Promise<ExchangeAccountState | null> {
    if (!this.mexcPrivate) {
      return extractExchangeAccountState(snapshot);
    }

    try {
      const [open, assets] = await Promise.all([this.mexcPrivate.getOpenPositions(), this.mexcPrivate.getAccountAssets()]);
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Boot recovery requires live MEXC account source-of-truth: ${message}`);
    }
  }

  private async loadTelegramModule(strategyName: string): Promise<BootStrategyTelegramModule | null> {
    const cached = this.moduleCache.get(strategyName);
    if (cached) return cached;

    const descriptor = this.strategies.find((strategy) => strategy.name === strategyName);
    if (!descriptor) return null;

    const moduleUrl = pathToFileURL(descriptor.telegramModulePath).toString();
    const loaded = (await import(moduleUrl)) as BootStrategyTelegramModule;
    this.moduleCache.set(strategyName, loaded);
    return loaded;
  }

  private resolveStrategyLabel(strategyName: string, module: BootStrategyTelegramModule): string {
    if (typeof module.STRATEGY_LABEL === "string" && module.STRATEGY_LABEL.length > 0) {
      return module.STRATEGY_LABEL;
    }

    return strategyName.toUpperCase();
  }

  private resolveEmoji(strategyName: string, module: BootStrategyTelegramModule): string {
    if (typeof module.STRATEGY_EMOJI === "string" && module.STRATEGY_EMOJI.length > 0) {
      return module.STRATEGY_EMOJI;
    }

    return "🎯";
  }

  private mapBootReason(reason: string): string {
    if (reason === "TP_BOOT_RECON") return "Take Profit (Boot Reconcile)";
    if (reason === "LIQ_BOOT_RECON") return "Liquidation (Boot Reconcile)";
    return reason;
  }
}
