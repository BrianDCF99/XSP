/**
 * Polls Telegram bot commands and sends strategy-specific replies.
 */
import { pathToFileURL } from "node:url";
import { RuntimeConfig } from "../../config/schema.js";
import { extractPriceMap } from "../../core/boot/priceMapExtractor.js";
import type { SymbolPerformanceSummary } from "../../db/repos/tradeRepository.js";
import { Repositories } from "../../db/repos/index.js";
import { ExchangeAccountState, extractExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import type { BybitSignalRow } from "../../exchange/signalMarketExtractor.js";
import { extractBybitPriceMapByMexcSymbol, extractBybitSignalRows } from "../../exchange/signalMarketExtractor.js";
import { TelegramClient } from "../../notifications/telegramClient.js";
import { TelegramCallbackQuery, TelegramUpdate } from "../../notifications/telegramTypes.js";
import { ManualActionProcessor } from "../manual/manualActionProcessor.js";
import { StrategyDescriptor } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import { buildStatusPayload } from "./statusPayloadBuilder.js";

type ParsedCommand =
  | { kind: "INFO"; strategyName: string }
  | { kind: "STATUS"; strategyName: string }
  | { kind: "SIG"; strategyName: string; symbolQuery: string }
  | { kind: "CLOSE"; strategyName: string }
  | { kind: "REFRESH" };

interface CloseSignalConfig {
  sellRatioMax: number;
  minHourVolume: number;
  sellRatioNearDelta: number;
  hourVolumeNearDelta: number;
  maxRows: number;
}

interface CloseSymbolRow {
  symbol: string;
  bybitPrice: number;
  mexcPrice: number;
  sellRatio: number;
  hourVolume: number;
}

const DEFAULT_CLOSE_SIGNAL_CONFIG: CloseSignalConfig = {
  sellRatioMax: 0.2,
  minHourVolume: 1_000_000,
  sellRatioNearDelta: 0.1,
  hourVolumeNearDelta: 300_000,
  maxRows: 12
};

interface StrategyTelegramModule {
  STRATEGY_LABEL?: string;
  STRATEGY_LEVERAGE?: number;
  STRATEGY_EMOJI?: string;
  buildInfoCommandMessage?: (input: {
    emoji: string;
    exchange: string;
    strategyLabel: string;
    leverage: number;
  }) => string;
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
    manualExitCandidates?: Array<{
      tickerDeepLinkTemplate: string;
      symbol: string;
      reason: string;
    }>;
  }) => string;
  buildSigCommandMessage?: (input: {
    emoji: string;
    strategyLabel: string;
    tickerDeepLinkTemplate: string;
    symbol: string;
    bybitPrice: number;
    mexcPrice: number;
    sellRatio: number;
    hourVolume: number;
    summary: SymbolPerformanceSummary;
  }) => string;
  CLOSE_SIGNAL_CONFIG?: Partial<CloseSignalConfig>;
  buildCloseCommandMessage?: (input: {
    emoji: string;
    strategyLabel: string;
    tickerDeepLinkTemplate: string;
    symbols: CloseSymbolRow[];
  }) => string;
}

function normalizeCommandToken(token: string): string {
  const command = token.startsWith("/") ? token.slice(1) : token;
  const [base] = command.split("@");
  return (base ?? "").trim().toLowerCase();
}

function buildStrategyAliases(name: string): string[] {
  const raw = name.trim().toLowerCase();
  if (raw.length === 0) return [];

  const aliases = new Set<string>([raw]);
  const withoutVersion = raw.replace(/[_-]?v\d+$/, "");
  if (withoutVersion.length > 0) {
    aliases.add(withoutVersion);
  }

  const firstSegment = raw.split(/[_-]/)[0];
  if (firstSegment && firstSegment.length > 0) {
    aliases.add(firstSegment);
  }

  return [...aliases];
}

function resolveStrategyName(input: string, strategyNames: string[]): string | null {
  const target = input.trim().toLowerCase();
  const exact = strategyNames.find((name) => name.toLowerCase() === target);
  if (exact) return exact;

  const aliasMatches = strategyNames.filter((name) => buildStrategyAliases(name).includes(target));
  if (aliasMatches.length === 1) {
    return aliasMatches[0]!;
  }

  return null;
}

function normalizeLookupToken(value: string): string {
  const upper = value.trim().toUpperCase();
  if (upper.length === 0) return upper;

  if (upper.includes("_")) {
    return upper.split("_")[0] ?? upper;
  }

  if (upper.endsWith("USDT")) {
    const base = upper.slice(0, -4);
    if (base.length > 0) return base;
  }
  if (upper.endsWith("USDC")) {
    const base = upper.slice(0, -4);
    if (base.length > 0) return base;
  }

  return upper;
}

function resolveSigStrategyName(maybeStrategy: string | undefined, strategyNames: string[]): string | null {
  if (typeof maybeStrategy === "string" && maybeStrategy.length > 0) {
    return resolveStrategyName(maybeStrategy, strategyNames);
  }

  if (strategyNames.length === 1) {
    return strategyNames[0]!;
  }

  return null;
}

function resolveCommandStrategyName(maybeStrategy: string | undefined, strategyNames: string[]): string | null {
  if (typeof maybeStrategy === "string" && maybeStrategy.length > 0) {
    const strategyName = resolveStrategyName(maybeStrategy, strategyNames);
    if (!strategyName) return null;
    return strategyName;
  }

  if (strategyNames.length === 1) {
    return strategyNames[0]!;
  }

  return null;
}

function parseCommand(text: string, strategyNames: string[]): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const token = normalizeCommandToken(parts[0] ?? "");

  if (token === "refresh") {
    return { kind: "REFRESH" };
  }

  if (token === "info") {
    const strategyName = resolveCommandStrategyName(parts[1], strategyNames);
    if (!strategyName) return null;
    return { kind: "INFO", strategyName };
  }

  if (token === "sig") {
    const symbolQuery = (parts[1] ?? "").trim();
    if (symbolQuery.length === 0) return null;

    const strategyName = resolveSigStrategyName(parts[2], strategyNames);
    if (!strategyName) return null;

    return {
      kind: "SIG",
      strategyName,
      symbolQuery
    };
  }

  if (token === "close") {
    const strategyName = resolveCommandStrategyName(parts[1], strategyNames);
    if (!strategyName) return null;
    return { kind: "CLOSE", strategyName };
  }

  const strategyName = resolveStrategyName(token, strategyNames);
  if (!strategyName) return null;
  return { kind: "STATUS", strategyName };
}

export class TelegramCommandService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private updateOffset: number | undefined;
  private nextWaitingPollAtMs = 0;
  private readonly moduleByStrategy = new Map<string, StrategyTelegramModule>();

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly repos: Repositories,
    private readonly collector: ExchangeCollector,
    private readonly telegram: TelegramClient,
    private readonly manualActionProcessor: ManualActionProcessor,
    private readonly logger: Logger,
    private readonly strategies: StrategyDescriptor[]
  ) {}

  async start(): Promise<void> {
    if (!this.telegram.isEnabled()) return;
    await this.loadModules();

    const existing = await this.telegram.getUpdates();
    if (existing.length > 0) {
      this.updateOffset = Math.max(...existing.map((u) => u.update_id)) + 1;
    }

    this.running = true;
    this.nextWaitingPollAtMs = Date.now();
    this.scheduleNext(0);

    this.logger.info("telegram command poller started", {
      pollMs: this.cfg.telegram.commandPollMs,
      strategies: this.strategies.map((s) => s.name)
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.logger.info("telegram command poller stopped");
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNext(this.cfg.telegram.commandPollMs));
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    try {
      await this.runManualMaintenance();
    } catch (error) {
      this.logger.error("telegram manual maintenance failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const updates = await this.telegram.getUpdates(this.updateOffset);
      if (updates.length === 0) return;

      for (const update of updates) {
        this.updateOffset = Math.max(this.updateOffset ?? 0, update.update_id + 1);
        try {
          await this.handleUpdate(update);
        } catch (error) {
          this.logger.error("telegram command update failed", {
            updateId: update.update_id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      this.logger.error("telegram command polling failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async loadModules(): Promise<void> {
    for (const strategy of this.strategies) {
      const moduleUrl = pathToFileURL(strategy.telegramModulePath).toString();
      const loaded = (await import(moduleUrl)) as StrategyTelegramModule;
      this.moduleByStrategy.set(strategy.name, loaded);
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackUpdate(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message?.text) return;

    const messageChatId = String(message.chat.id);
    if (messageChatId !== this.cfg.env.telegramChatId) {
      if (message.text.trim().startsWith("/")) {
        this.logger.warn("telegram command ignored", {
          reason: "chat_mismatch",
          command: message.text,
          expectedChatId: this.cfg.env.telegramChatId,
          receivedChatId: messageChatId
        });
      }
      return;
    }

    const strategyNames = this.strategies.map((s) => s.name);
    const parsed = parseCommand(message.text, strategyNames);
    if (!parsed) {
      if (message.text.trim().startsWith("/")) {
        this.logger.warn("telegram command ignored", {
          reason: "unrecognized_command_or_strategy",
          command: message.text
        });
      }
      return;
    }

    if (parsed.kind === "REFRESH") {
      await this.handleRefreshCommand();
      return;
    }

    if (parsed.kind === "INFO") {
      await this.handleInfoCommand(parsed.strategyName);
      return;
    }

    if (parsed.kind === "SIG") {
      await this.handleSigCommand(parsed.strategyName, parsed.symbolQuery);
      return;
    }

    if (parsed.kind === "CLOSE") {
      await this.handleCloseCommand(parsed.strategyName);
      return;
    }

    await this.handleStatusCommand(parsed.strategyName);
  }

  private async handleCallbackUpdate(callback: TelegramCallbackQuery): Promise<void> {
    const chatId = callback.message?.chat.id;
    if (typeof chatId !== "number") return;
    if (String(chatId) !== this.cfg.env.telegramChatId) return;
    if (!this.cfg.manualExecution.enabled) return;

    await this.manualActionProcessor.handleCallbackQuery(callback);
  }

  private async runManualMaintenance(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;

    await this.manualActionProcessor.syncTakeProfitsIfDue();
    await this.manualActionProcessor.pollAutoConfirmExitAlerts();
    await this.manualActionProcessor.runAutoRefreshIfDue();

    const nowMs = Date.now();
    if (nowMs < this.nextWaitingPollAtMs) return;

    this.nextWaitingPollAtMs = nowMs + this.cfg.manualExecution.pendingPollMs;
    await this.manualActionProcessor.pollWaitingAlerts();
  }

  private async handleRefreshCommand(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) {
      const text = `Refresh unavailable (${this.collector.exchangeName.toUpperCase()})\nmanualExecution.enabled is false`;
      await this.telegram.sendMessage(text);
      return;
    }

    this.logger.info("manual refresh command received", {
      exchange: this.collector.exchangeName
    });

    let summary: {
      strategiesUpdated: number;
      messageCount: number;
      eventCount: number;
    };
    try {
      summary = await this.manualActionProcessor.runGlobalRefresh("manual");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      this.logger.error("manual refresh command failed", {
        exchange: this.collector.exchangeName,
        error: errorText
      });

      const text = [`Refresh failed (${this.collector.exchangeName.toUpperCase()})`, `Error: ${errorText}`].join("\n");
      const failedMessageId = await this.telegram.sendMessage(text);
      if (failedMessageId === null) {
        this.logger.error("manual refresh failure message not delivered", {
          exchange: this.collector.exchangeName
        });
      }
      return;
    }

    this.logger.info("manual refresh command completed", {
      exchange: this.collector.exchangeName,
      strategiesUpdated: summary.strategiesUpdated,
      messagesPublished: summary.messageCount,
      eventsPersisted: summary.eventCount
    });

    const text = [
      `Refresh complete (${this.collector.exchangeName.toUpperCase()})`,
      `Strategies updated: ${summary.strategiesUpdated}`,
      `Messages published: ${summary.messageCount}`,
      `Events persisted: ${summary.eventCount}`
    ].join("\n");

    const messageId = await this.telegram.sendMessage(text);
    if (messageId === null) {
      this.logger.error("manual refresh summary not delivered", {
        exchange: this.collector.exchangeName
      });
    }
  }

  private async handleInfoCommand(strategyName: string): Promise<void> {
    const module = this.moduleByStrategy.get(strategyName);
    if (!module?.buildInfoCommandMessage) return;

    const text = module.buildInfoCommandMessage({
      emoji: this.resolveEmoji(strategyName, module),
      exchange: this.collector.exchangeName.toUpperCase(),
      strategyLabel: this.resolveStrategyLabel(strategyName, module),
      leverage: module.STRATEGY_LEVERAGE ?? 1
    });

    await this.telegram.sendMessage(text);
  }

  private async handleStatusCommand(strategyName: string): Promise<void> {
    const module = this.moduleByStrategy.get(strategyName);
    if (!module?.buildStrategyStatusTelegramMessage) return;

    const [openPositions, latestSnapshot, firstSnapshot, snapshot] = await Promise.all([
      this.repos.trades.getOpenPositionsByStrategy(strategyName),
      this.repos.equity.getLatestSnapshotByStrategy(strategyName),
      this.repos.equity.getFirstByStrategy(strategyName),
      this.collector.collectFuturesData()
    ]);

    let liveExchangeAccount: ExchangeAccountState | null;
    if (this.cfg.manualExecution.enabled && this.collector.exchangeName.toLowerCase() === "mexc") {
      const privateState = await this.manualActionProcessor.fetchLiveExchangeAccountState();
      if (!privateState) {
        throw new Error("Status command requires live MEXC account source-of-truth");
      }
      liveExchangeAccount = privateState;
    } else {
      liveExchangeAccount = extractExchangeAccountState(snapshot);
    }

    const startingEquityUsd = firstSnapshot?.equityUsd ?? liveExchangeAccount?.equityUsd;
    const bybitPriceBySymbol = extractBybitPriceMapByMexcSymbol(snapshot);
    const statusInput = {
      openPositions,
      latestSnapshot,
      priceBySymbol: extractPriceMap(snapshot),
      bybitPriceBySymbol,
      tickerDeepLinkTemplate: this.collector.tickerDeepLinkTemplate,
      liveExchangeAccount
    };
    const status = Number.isFinite(startingEquityUsd)
      ? buildStatusPayload({
          ...statusInput,
          startingEquityUsd: Number(startingEquityUsd)
        })
      : buildStatusPayload(statusInput);

    const text = module.buildStrategyStatusTelegramMessage({
      emoji: this.resolveEmoji(strategyName, module),
      exchange: this.collector.exchangeName.toUpperCase(),
      strategyLabel: this.resolveStrategyLabel(strategyName, module),
      positions: status.positions,
      live: status.live
    });

    await this.telegram.sendMessage(text);
  }

  private async handleSigCommand(strategyName: string, symbolQuery: string): Promise<void> {
    const module = this.moduleByStrategy.get(strategyName);

    const snapshot = await this.collector.collectFuturesData();
    const market = extractBybitSignalRows(snapshot);
    const matched = this.resolveSigRow(symbolQuery, market.rows);

    if (!matched) {
      await this.telegram.sendMessage(`No symbol found for '${symbolQuery}'.`);
      return;
    }

    const summary = await this.repos.trades.getSymbolPerformanceSummary(strategyName, matched.mexcSymbol);
    const text =
      module?.buildSigCommandMessage?.({
        emoji: this.resolveEmoji(strategyName, module),
        strategyLabel: this.resolveStrategyLabel(strategyName, module),
        tickerDeepLinkTemplate: this.collector.tickerDeepLinkTemplate,
        symbol: matched.mexcSymbol,
        bybitPrice: matched.bybitPrice,
        mexcPrice: matched.mexcPrice,
        sellRatio: matched.sellRatio,
        hourVolume: matched.hourVolume,
        summary
      }) ??
      this.buildDefaultSigMessage(matched, summary);

    await this.telegram.sendMessage(text);
  }

  private resolveSigRow(symbolQuery: string, rows: BybitSignalRow[]): BybitSignalRow | null {
    const query = normalizeLookupToken(symbolQuery);
    if (query.length === 0) return null;

    const fullUpper = symbolQuery.trim().toUpperCase();
    const exact = rows.find(
      (row) => row.mexcSymbol.toUpperCase() === fullUpper || row.bybitSymbol.toUpperCase() === fullUpper
    );
    if (exact) return exact;

    return (
      rows.find((row) => {
        const mexcBase = normalizeLookupToken(row.mexcSymbol);
        const bybitBase = normalizeLookupToken(row.bybitSymbol);
        return mexcBase === query || bybitBase === query;
      }) ?? null
    );
  }

  private buildDefaultSigMessage(row: BybitSignalRow, summary: SymbolPerformanceSummary): string {
    const winPct = Number.isFinite(summary.winPct) ? summary.winPct.toFixed(2) : "0.00";
    const volMillions = Number.isFinite(row.hourVolume) ? (row.hourVolume / 1_000_000).toFixed(2) : "N/A";
    const fmtPrice = (value: number) => (Number.isFinite(value) ? `$${value.toFixed(4)}` : "N/A");
    const fmtUsd = (value: number) => {
      if (!Number.isFinite(value)) return "$0.00";
      const sign = value > 0 ? "+" : value < 0 ? "-" : "";
      return `${sign}$${Math.abs(value).toFixed(2)}`;
    };

    return [
      `${row.mexcSymbol}`,
      `Bybit: ${fmtPrice(row.bybitPrice)}`,
      `Mexc: ${fmtPrice(row.mexcPrice)}`,
      `SR: ${Number.isFinite(row.sellRatio) ? row.sellRatio.toFixed(2) : "N/A"}`,
      `Vol: ${volMillions} M`,
      "",
      "Symbol Summary:",
      `Trades: ${summary.trades}`,
      `Wins: ${summary.wins}`,
      `Losses: ${summary.losses}`,
      `Liq'd: ${summary.liquidations}`,
      `Win %: ${winPct}%`,
      `Total PNL: ${fmtUsd(summary.totalPnlUsd)}`,
      `Total Funding: ${fmtUsd(summary.totalFundingUsd)}`
    ].join("\n");
  }

  private async handleCloseCommand(strategyName: string): Promise<void> {
    const module = this.moduleByStrategy.get(strategyName);
    const config = this.resolveCloseSignalConfig(module?.CLOSE_SIGNAL_CONFIG);
    const snapshot = await this.collector.collectFuturesData();
    const market = extractBybitSignalRows(snapshot);
    const symbols = this.selectCloseSymbols(market.rows, config);

    if (symbols.length === 0) {
      await this.telegram.sendMessage("No close symbols right now.");
      return;
    }

    const text =
      module?.buildCloseCommandMessage?.({
        emoji: this.resolveEmoji(strategyName, module),
        strategyLabel: this.resolveStrategyLabel(strategyName, module),
        tickerDeepLinkTemplate: this.collector.tickerDeepLinkTemplate,
        symbols
      }) ?? this.buildDefaultCloseMessage(symbols);

    await this.telegram.sendMessage(text);
  }

  private resolveCloseSignalConfig(partial: Partial<CloseSignalConfig> | undefined): CloseSignalConfig {
    const source = partial ?? {};

    const positiveOrDefault = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    return {
      sellRatioMax: positiveOrDefault(source.sellRatioMax, DEFAULT_CLOSE_SIGNAL_CONFIG.sellRatioMax),
      minHourVolume: positiveOrDefault(source.minHourVolume, DEFAULT_CLOSE_SIGNAL_CONFIG.minHourVolume),
      sellRatioNearDelta: positiveOrDefault(source.sellRatioNearDelta, DEFAULT_CLOSE_SIGNAL_CONFIG.sellRatioNearDelta),
      hourVolumeNearDelta: positiveOrDefault(source.hourVolumeNearDelta, DEFAULT_CLOSE_SIGNAL_CONFIG.hourVolumeNearDelta),
      maxRows: Math.floor(positiveOrDefault(source.maxRows, DEFAULT_CLOSE_SIGNAL_CONFIG.maxRows))
    };
  }

  private selectCloseSymbols(rows: BybitSignalRow[], config: CloseSignalConfig): CloseSymbolRow[] {
    const score = (row: BybitSignalRow): number => {
      const srDistance = Math.max(0, row.sellRatio - config.sellRatioMax);
      const volDistance = Math.max(0, config.minHourVolume - row.hourVolume);
      const srScore = srDistance / config.sellRatioNearDelta;
      const volScore = volDistance / config.hourVolumeNearDelta;
      return Math.min(srScore, volScore);
    };

    return rows
      .filter((row) => Number.isFinite(row.sellRatio) && Number.isFinite(row.hourVolume))
      .filter((row) => {
        const srDistance = Math.max(0, row.sellRatio - config.sellRatioMax);
        const volDistance = Math.max(0, config.minHourVolume - row.hourVolume);
        const nearOrGoodSellRatio = srDistance <= config.sellRatioNearDelta;
        const nearOrGoodVolume = volDistance <= config.hourVolumeNearDelta;
        return nearOrGoodSellRatio || nearOrGoodVolume;
      })
      .sort((a, b) => {
        const scoreDelta = score(a) - score(b);
        if (scoreDelta !== 0) return scoreDelta;
        if (a.sellRatio !== b.sellRatio) return a.sellRatio - b.sellRatio;
        return b.hourVolume - a.hourVolume;
      })
      .slice(0, config.maxRows)
      .map((row) => ({
        symbol: row.mexcSymbol,
        bybitPrice: row.bybitPrice,
        mexcPrice: row.mexcPrice,
        sellRatio: row.sellRatio,
        hourVolume: row.hourVolume
      }));
  }

  private buildDefaultCloseMessage(symbols: CloseSymbolRow[]): string {
    const fmtPrice = (value: number) => (Number.isFinite(value) ? `$${value.toFixed(4)}` : "N/A");
    const fmtSr = (value: number) => (Number.isFinite(value) ? value.toFixed(2) : "N/A");
    const fmtVol = (value: number) => (Number.isFinite(value) ? `${(value / 1_000_000).toFixed(2)} M` : "N/A");

    const lines = ["👀 Close Symbols", ""];
    for (let i = 0; i < symbols.length; i += 1) {
      const item = symbols[i]!;
      lines.push(`${i + 1}. ${item.symbol}`);
      lines.push(`    Bybit: ${fmtPrice(item.bybitPrice)}`);
      lines.push(`    Mexc:  ${fmtPrice(item.mexcPrice)}`);
      lines.push(`    SR:           ${fmtSr(item.sellRatio)}`);
      lines.push(`    Vol:          ${fmtVol(item.hourVolume)}`);
      if (i < symbols.length - 1) lines.push("");
    }

    return lines.join("\n");
  }

  private resolveStrategyLabel(strategyName: string, module: StrategyTelegramModule): string {
    if (typeof module.STRATEGY_LABEL === "string" && module.STRATEGY_LABEL.length > 0) {
      return module.STRATEGY_LABEL;
    }

    return strategyName.toUpperCase();
  }

  private resolveEmoji(strategyName: string, module: StrategyTelegramModule): string {
    if (typeof module.STRATEGY_EMOJI === "string" && module.STRATEGY_EMOJI.length > 0) {
      return module.STRATEGY_EMOJI;
    }

    return "🎯";
  }
}
