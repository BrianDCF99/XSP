/**
 * Polls Telegram bot commands and sends strategy-specific replies.
 */
import { pathToFileURL } from "node:url";
import { RuntimeConfig } from "../../config/schema.js";
import { extractPriceMap } from "../../core/boot/priceMapExtractor.js";
import { Repositories } from "../../db/repos/index.js";
import { ExchangeAccountState, extractExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { ExchangeCollector } from "../../exchange/exchangeCollector.js";
import { TelegramClient } from "../../notifications/telegramClient.js";
import { TelegramCallbackQuery, TelegramUpdate } from "../../notifications/telegramTypes.js";
import { ManualActionProcessor } from "../manual/manualActionProcessor.js";
import { StrategyDescriptor } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import { buildStatusPayload } from "./statusPayloadBuilder.js";

type ParsedCommand =
  | { kind: "INFO"; strategyName: string }
  | { kind: "STATUS"; strategyName: string }
  | { kind: "REFRESH" };

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

function parseCommand(text: string, strategyNames: string[]): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const token = normalizeCommandToken(parts[0] ?? "");

  if (token === "refresh") {
    return { kind: "REFRESH" };
  }

  if (token === "info") {
    const maybeStrategy = parts[1];
    if (typeof maybeStrategy === "string" && maybeStrategy.length > 0) {
      const strategyName = resolveStrategyName(maybeStrategy, strategyNames);
      if (!strategyName) return null;
      return { kind: "INFO", strategyName };
    }

    if (strategyNames.length === 1) {
      return { kind: "INFO", strategyName: strategyNames[0]! };
    }

    return null;
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

      const updates = await this.telegram.getUpdates(this.updateOffset);
      if (updates.length === 0) return;

      for (const update of updates) {
        this.updateOffset = Math.max(this.updateOffset ?? 0, update.update_id + 1);
        await this.handleUpdate(update);
      }
    } catch (error) {
      this.logger.error("telegram command poll failed", {
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

    if (String(message.chat.id) !== this.cfg.env.telegramChatId) {
      return;
    }

    const strategyNames = this.strategies.map((s) => s.name);
    const parsed = parseCommand(message.text, strategyNames);
    if (!parsed) return;

    if (parsed.kind === "REFRESH") {
      await this.handleRefreshCommand();
      return;
    }

    if (parsed.kind === "INFO") {
      await this.handleInfoCommand(parsed.strategyName);
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

    await this.manualActionProcessor.runAutoRefreshIfDue();

    const nowMs = Date.now();
    if (nowMs < this.nextWaitingPollAtMs) return;

    this.nextWaitingPollAtMs = nowMs + this.cfg.manualExecution.pendingPollMs;
    await this.manualActionProcessor.pollWaitingAlerts();
  }

  private async handleRefreshCommand(): Promise<void> {
    if (!this.cfg.manualExecution.enabled) return;
    await this.manualActionProcessor.runGlobalRefresh("manual");
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
    const statusInput = {
      openPositions,
      latestSnapshot,
      priceBySymbol: extractPriceMap(snapshot),
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
