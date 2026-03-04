/**
 * Composes all runtime dependencies for LiveTrader.
 */
import { setDefaultResultOrder } from "node:dns";
import { loadConfig } from "../config/loadConfig.js";
import { BootRecoveryService } from "../core/boot/bootRecoveryService.js";
import { CycleRunner } from "../core/cycleRunner.js";
import { RunLoop } from "../core/runLoop.js";
import { createRepositories } from "../db/repos/index.js";
import { createSupabaseClient } from "../db/supabaseClient.js";
import { ExchangeCollector } from "../exchange/exchangeCollector.js";
import { MessageDispatcher } from "../notifications/messageDispatcher.js";
import { TelegramClient } from "../notifications/telegramClient.js";
import { ManualActionProcessor } from "../services/manual/manualActionProcessor.js";
import { ManualAlertService } from "../services/manual/manualAlertService.js";
import { TelegramCommandService } from "../services/telegram/telegramCommandService.js";
import { loadStrategyRegistry } from "../strategies/strategyRegistry.js";
import { createLogger } from "../utils/logger.js";
import { LiveTraderApp } from "./liveTraderApp.js";

export function createApp(): LiveTraderApp {
  const cfg = loadConfig();
  const logger = createLogger(cfg.env.nodeEnv !== "production");

  if (cfg.telegram.enabled && cfg.telegram.preferIpv4) {
    setDefaultResultOrder("ipv4first");
    logger.info("dns result order set", {
      order: "ipv4first",
      reason: "telegram.preferIpv4"
    });
  }

  const db = createSupabaseClient(cfg);
  const repos = createRepositories(db);
  const collector = new ExchangeCollector(cfg, logger);
  const telegram = new TelegramClient(cfg, logger);
  const messageDispatcher = new MessageDispatcher(telegram);
  const strategies = loadStrategyRegistry(cfg);
  const manualAlertService = new ManualAlertService(repos);
  const strictLiveAccountMode = cfg.manualExecution.enabled && collector.exchangeName.toLowerCase() === "mexc";
  const manualActionProcessor = new ManualActionProcessor(
    cfg,
    repos,
    collector,
    telegram,
    messageDispatcher,
    manualAlertService,
    logger,
    strategies
  );
  const cycleRunner = new CycleRunner(
    cfg,
    logger,
    collector,
    repos,
    messageDispatcher,
    manualAlertService,
    strategies,
    strictLiveAccountMode ? async () => manualActionProcessor.fetchLiveExchangeAccountState() : undefined,
    strictLiveAccountMode
  );
  const runLoop = new RunLoop(cfg, logger, async () => cycleRunner.runCycle());
  const bootRecovery = new BootRecoveryService(cfg, repos, collector, telegram, logger, strategies);
  const telegramCommands = new TelegramCommandService(
    cfg,
    repos,
    collector,
    telegram,
    manualActionProcessor,
    logger,
    strategies
  );

  logger.info("livetrader bootstrapped", {
    executionExchange: cfg.exchange.execution.name,
    signalExchange: cfg.exchange.signal.name,
    strategyCount: strategies.length,
    scheduleUnit: cfg.scheduler.cadence.unit,
    scheduleEvery: cfg.scheduler.cadence.every,
    offsetSeconds: cfg.scheduler.cadence.offsetSeconds
  });

  return new LiveTraderApp(runLoop, {
    onBeforeStart: async () => {
      await bootRecovery.run();
      await manualActionProcessor.start();
      if (cfg.manualExecution.enabled) {
        await manualActionProcessor.runGlobalRefresh("auto");
      }
    },
    onAfterStart: async () => {
      await telegramCommands.start();
    },
    onBeforeStop: async () => {
      await telegramCommands.stop();
    }
  });
}
