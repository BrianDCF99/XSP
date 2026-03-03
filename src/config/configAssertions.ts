/**
 * Focused runtime configuration assertions.
 */
import { RuntimeConfig } from "./schema.js";

export function assertExchangeExists(activeExchange: string, exchanges: Record<string, unknown>): void {
  if (Object.prototype.hasOwnProperty.call(exchanges, activeExchange)) return;
  throw new Error(`Active exchange '${activeExchange}' is missing in exchange.exchanges`);
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

  if (cfg.manualExecution.enabled && cfg.exchange.active.toLowerCase() === "mexc") {
    if (!cfg.env.mexcApiKey || !cfg.env.mexcApiSecret) {
      throw new Error("Manual execution is enabled for MEXC but MEXC_API_KEY / MEXC_API_SECRET are missing in .env");
    }
  }
}
