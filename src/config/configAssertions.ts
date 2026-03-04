/**
 * Focused runtime configuration assertions.
 */
import { RuntimeConfig } from "./schema.js";

export function assertExchangePair(cfg: RuntimeConfig): void {
  const signal = cfg.exchange.signal.name.toLowerCase();
  const execution = cfg.exchange.execution.name.toLowerCase();

  if (signal !== "bybit" || execution !== "mexc") {
    throw new Error(
      `Invalid exchange pair: signal='${cfg.exchange.signal.name}', execution='${cfg.exchange.execution.name}'. Expected signal=bybit and execution=mexc.`
    );
  }
}

export function assertStrategyFoldersConfigured(activeStrategies: string[]): void {
  if (activeStrategies.length > 0) return;
  throw new Error("At least one active strategy is required in strategies.active");
}

export function assertRequiredSecrets(cfg: RuntimeConfig): void {
  if (cfg.supabase.enabled && (!cfg.env.supabaseUrl || !cfg.env.supabaseServiceRoleKey)) {
    throw new Error("Supabase is enabled but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing in .env");
  }

  if (cfg.telegram.enabled && (!cfg.env.telegramBotToken || !cfg.env.telegramChatId)) {
    throw new Error("Telegram is enabled but TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are missing in .env");
  }

  if (cfg.manualExecution.enabled && cfg.exchange.execution.name.toLowerCase() === "mexc") {
    if (!cfg.env.mexcApiKey || !cfg.env.mexcApiSecret) {
      throw new Error("Manual execution is enabled for MEXC but MEXC_API_KEY / MEXC_API_SECRET are missing in .env");
    }
  }
}
