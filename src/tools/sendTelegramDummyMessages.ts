/**
 * Sends one dummy instance of each Telegram message type for every active strategy.
 */
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/loadConfig.js";
import { TelegramClient } from "../notifications/telegramClient.js";
import { loadStrategyRegistry } from "../strategies/strategyRegistry.js";
import { TelegramReplyMarkup } from "../strategies/types.js";
import { createLogger } from "../utils/logger.js";

type MessageBuilder = (input: Record<string, unknown>) => string;

type StrategyTelegramModule = {
  STRATEGY_LABEL?: string;
  STRATEGY_LEVERAGE?: number;
  STRATEGY_EMOJI?: string;
  [key: string]: unknown;
};

interface PreviewMessage {
  kind: string;
  text: string;
  replyMarkup?: TelegramReplyMarkup;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asBuilder(module: StrategyTelegramModule, name: string): MessageBuilder | null {
  const candidate = module[name];
  return typeof candidate === "function" ? (candidate as MessageBuilder) : null;
}

function addPreview(
  target: PreviewMessage[],
  logger: ReturnType<typeof createLogger>,
  strategyName: string,
  module: StrategyTelegramModule,
  name: string,
  input: Record<string, unknown>,
  replyMarkup?: TelegramReplyMarkup
): void {
  const builder = asBuilder(module, name);
  if (!builder) return;

  try {
    const text = builder(input);
    const preview: PreviewMessage = {
      kind: name,
      text
    };
    if (replyMarkup) {
      preview.replyMarkup = replyMarkup;
    }
    target.push(preview);
  } catch (error) {
    logger.error("dummy telegram builder failed", {
      strategy: strategyName,
      builder: name,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildDummyPreviews(
  logger: ReturnType<typeof createLogger>,
  strategyName: string,
  module: StrategyTelegramModule,
  tickerTemplate: string,
  exchange: string
): PreviewMessage[] {
  const previews: PreviewMessage[] = [];

  const strategyLabel = module.STRATEGY_LABEL ?? strategyName;
  const strategyEmoji = module.STRATEGY_EMOJI ?? "🎯";
  const leverage = Number.isFinite(module.STRATEGY_LEVERAGE) ? Number(module.STRATEGY_LEVERAGE) : 5;

  const account = {
    equityUsd: 10_450.73,
    cashUsd: 9_610.42,
    marginInUseUsd: 840.31,
    openNotionalUsd: 4_201.55,
    netFundingUsd: -21.44
  };

  const baseInput = {
    emoji: strategyEmoji,
    exchange,
    strategyLabel
  };

  const symbol = "BTC_USDT";
  const altSymbol = "ETH_USDT";

  addPreview(previews, logger, strategyName, module, "buildInfoCommandMessage", {
    ...baseInput,
    leverage
  });

  addPreview(previews, logger, strategyName, module, "buildEntryAvailableTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol,
    bybitPriceAtAlert: 62_481.1234,
    mexcPriceAtAlert: 62_490.7777,
    marginToPut: 100,
    takeProfitEstimatePrice: 59_865.7000,
    sellRatioNow: 0.1482,
    hourVolumeNow: 3_845_100,
    currentOpenTrades: 4,
    priceAtAlert: 62_490.7777,
    sellRatioMax: 0.2,
    minHourVolume: 1_000_000,
    concurrentCap: 15
  }, {
    inlineKeyboard: [
      [
        { text: "Opened", callbackData: "dummy|opened" },
        { text: "Decline", callbackData: "dummy|decline" },
        { text: "Refresh", callbackData: "dummy|refresh" }
      ]
    ]
  });

  addPreview(previews, logger, strategyName, module, "buildReplacementAvailableTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    loserSymbol: altSymbol,
    loserBybitEntryPrice: 2_430.1,
    loserBybitCurrentPrice: 2_505.55,
    loserEntryPrice: 2_429.8,
    loserPnlPct: -6.43,
    loserPnlUsd: -64.3,
    loserAge: "01-12:42",
    loserCurrentPrice: 2_506.12,
    loserTakeProfitPrice: 2_332.61,
    loserLiquidationPrice: 2_915.76,
    newSymbol: symbol,
    newBybitPriceAtAlert: 62_481.1234,
    newMexcPriceAtAlert: 62_490.7777,
    marginToPut: 100,
    newSellRatioNow: 0.1299,
    newHourVolumeNow: 4_901_220,
    replacementThresholdPct: -5,
    newPriceAtAlert: 62_490.7777,
    sellRatioMax: 0.2,
    minHourVolume: 1_000_000
  }, {
    inlineKeyboard: [
      [
        { text: "Opened", callbackData: "dummy|opened" },
        { text: "Refresh", callbackData: "dummy|refresh" }
      ]
    ]
  });

  addPreview(previews, logger, strategyName, module, "buildTrackDecisionTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol: "SOL_USDT",
    entryPrice: 122.44,
    takeProfitPrice: 117.54,
    liquidationPrice: 146.92,
    sellRatioMax: 0.2,
    minHourVolume: 1_000_000,
    concurrentCap: 15,
    sellRatioNow: 0.1871,
    hourVolumeNow: 1_872_500,
    currentOpenTrades: 5
  }, {
    inlineKeyboard: [
      [
        { text: "Track", callbackData: "dummy|track" },
        { text: "Do Not Track", callbackData: "dummy|ignore" }
      ]
    ]
  });

  addPreview(previews, logger, strategyName, module, "buildExitAvailableTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol: altSymbol,
    reason: "Take Profit",
    bybitEntryPrice: 2_430.1,
    bybitCurrentPrice: 2_332.6,
    entryPrice: 2_429.8,
    pnlPct: 20.07,
    pnlUsd: 200.7,
    age: "02-03:10",
    currentPrice: 2_332.61,
    takeProfitPrice: 2_332.61,
    liquidationPrice: 2_915.76
  }, {
    inlineKeyboard: [
      [
        { text: "Closed", callbackData: "dummy|closed" },
        { text: "Refresh", callbackData: "dummy|refresh" }
      ]
    ]
  });

  addPreview(previews, logger, strategyName, module, "buildEntryConfirmedTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol,
    entryPrice: 62_490.7777,
    realizedEntryPrice: 62_501.1249,
    takeProfitPrice: 59_990.1234,
    liquidationPrice: 74_988.9231,
    entrySlippageBps: 5.17,
    account
  });

  addPreview(previews, logger, strategyName, module, "buildWaitingForConfirmationMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol,
    symbols: [symbol, altSymbol, "SOL_USDT"]
  });

  addPreview(previews, logger, strategyName, module, "buildFundingTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    updates: [
      { symbol, fundingUsd: -2.51, netFundingUsd: -7.21 },
      { symbol: altSymbol, fundingUsd: 1.14, netFundingUsd: -3.08 }
    ],
    account
  });

  addPreview(previews, logger, strategyName, module, "buildExitConfirmedTelegramMessage", {
    ...baseInput,
    tickerDeepLinkTemplate: tickerTemplate,
    symbol: altSymbol,
    reason: "Sell Ratio Delta",
    pnlUsd: -82.35,
    pnlPct: -8.24,
    exitSlippageBps: 7.12,
    roundtripSlippageBps: 12.42,
    fundingUsd: -1.84,
    account
  });

  addPreview(previews, logger, strategyName, module, "buildStrategyStatusTelegramMessage", {
    ...baseInput,
    positions: [
      {
        tickerDeepLinkTemplate: tickerTemplate,
        symbol,
        bybitEntryPrice: 63_001.1,
        bybitCurrentPrice: 62_422.4,
        entryPrice: 63_015.21,
        pnlPct: 4.7,
        pnlUsd: 47.08,
        age: "00-11:22",
        currentPrice: 62_423.09,
        takeProfitPrice: 60_494.6,
        liquidationPrice: 75_618.25
      },
      {
        tickerDeepLinkTemplate: tickerTemplate,
        symbol: altSymbol,
        bybitEntryPrice: 2_401.7,
        bybitCurrentPrice: 2_431.8,
        entryPrice: 2_399.2,
        pnlPct: -6.8,
        pnlUsd: -68.0,
        age: "01-03:45",
        currentPrice: 2_432.0,
        takeProfitPrice: 2_303.2,
        liquidationPrice: 2_879.0
      }
    ],
    live: {
      pnlPct: 1.22,
      pnlUsd: 122.44,
      unrealizedPnlUsd: -20.92,
      unrealizedPnlPct: -0.2,
      entries: 31,
      openTrades: 2,
      missed: 4,
      winners: 18,
      losers: 11,
      winPct: 62.07,
      replaced: 3,
      liquidations: 1,
      equityUsd: 10_450.73,
      cashUsd: 9_610.42,
      marginInUseUsd: 840.31,
      openNotionalUsd: 4_201.55,
      netFundingUsd: -21.44
    },
    manualExitCandidates: [
      {
        tickerDeepLinkTemplate: tickerTemplate,
        symbol: "SOL_USDT",
        reason: "Should have exited while bot was offline"
      }
    ]
  });

  addPreview(previews, logger, strategyName, module, "buildNoSignalTelegramMessage", {
    ...baseInput
  });

  return previews;
}

async function sendPreviewSuite(): Promise<void> {
  const cfg = loadConfig();
  const logger = createLogger(true);
  const telegram = new TelegramClient(cfg, logger);

  if (!telegram.isEnabled()) {
    throw new Error("telegram.enabled is false in config.yaml");
  }

  const strategies = loadStrategyRegistry(cfg);
  if (strategies.length === 0) {
    throw new Error("No active strategies configured");
  }

  let sent = 0;
  let failed = 0;

  for (const strategy of strategies) {
    const moduleUrl = pathToFileURL(strategy.telegramModulePath).toString();
    const module = (await import(moduleUrl)) as StrategyTelegramModule;

    const previews = buildDummyPreviews(
      logger,
      strategy.name,
      module,
      cfg.exchange.execution.tickerDeepLinkTemplate,
      cfg.exchange.execution.name.toUpperCase()
    );

    await telegram.sendMessage(`🧪 Dummy Telegram suite start: ${strategy.name} (${previews.length} messages)`);
    await sleep(250);

    for (const preview of previews) {
      const messageId = await telegram.sendMessage(preview.text, preview.replyMarkup);
      if (messageId === null) {
        failed += 1;
      } else {
        sent += 1;
      }
      await sleep(250);
    }

    await telegram.sendMessage(`🧪 Dummy Telegram suite end: ${strategy.name}`);
    await sleep(250);
  }

  logger.info("dummy telegram suite finished", {
    strategies: strategies.map((s) => s.name),
    sent,
    failed
  });
}

sendPreviewSuite().catch((error) => {
  console.error(`${new Date().toISOString()} [ERROR] dummy telegram suite failed`, error);
  process.exit(1);
});
