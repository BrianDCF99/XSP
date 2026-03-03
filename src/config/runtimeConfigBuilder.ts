/**
 * Builds RuntimeConfig from validated file config + env config.
 */
import { EnvConfig, FileConfig, RuntimeConfig } from "./schema.js";

export function buildRuntimeConfig(fileConfig: FileConfig, env: EnvConfig): RuntimeConfig {
  const runtimeConfig: RuntimeConfig = {
    ...fileConfig,
    env: {
      nodeEnv: env.NODE_ENV ?? fileConfig.app.environment,
      supabaseUrl: env.SUPABASE_URL ?? "",
      supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? "",
      telegramChatId: env.TELEGRAM_CHAT_ID ?? "",
      mexcApiKey: env.MEXC_API_KEY ?? "",
      mexcApiSecret: env.MEXC_API_SECRET ?? ""
    }
  };

  if (env.SUPABASE_SCHEMA) {
    runtimeConfig.supabase.schema = env.SUPABASE_SCHEMA;
  }

  return runtimeConfig;
}
