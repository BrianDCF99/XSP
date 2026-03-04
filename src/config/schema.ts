/**
 * Runtime configuration schema for LiveTrader.
 * This schema intentionally excludes strategy internals.
 */
import { z } from "zod";

const PositiveInt = z.number().int().positive();
const NonNegativeInt = z.number().int().min(0);
const CadenceSchema = z.object({
  unit: z.enum(["minute", "hour"]),
  every: PositiveInt,
  offsetSeconds: NonNegativeInt.max(59)
});

const EndpointSchema = z.object({
  name: z.string().min(1),
  method: z.enum(["GET", "POST"]).default("GET"),
  path: z.string().min(1),
  pathParams: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  symbolFanout: z.boolean().default(false),
  minuteBackfill: z.boolean().default(false),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([])
});

const ExchangeNameSchema = z.enum(["mexc", "bybit"]);

const ExchangeSchema = z.object({
  name: ExchangeNameSchema,
  restBaseUrl: z.string().url(),
  privateApi: z
    .object({
      baseUrl: z.string().url(),
      recvWindowMs: PositiveInt.default(10000)
    })
    .optional(),
  tickerDeepLinkTemplate: z.string().min(1),
  futuresEndpoints: z.array(EndpointSchema).min(1)
});

export const FileConfigSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    environment: z.string().min(1),
    timezone: z.string().min(1)
  }),
  scheduler: z.object({
    cadence: CadenceSchema,
    immediateRunOnBoot: z.boolean().default(true)
  }),
  exchange: z.object({
    requestTimeoutMs: PositiveInt,
    maxParallelRequests: PositiveInt,
    signal: ExchangeSchema,
    execution: ExchangeSchema
  }),
  strategies: z.object({
    basePath: z.string().min(1),
    active: z.array(z.string().min(1)).min(1)
  }),
  telegram: z.object({
    enabled: z.boolean(),
    parseMode: z.enum(["HTML", "MarkdownV2", "Markdown"]).default("HTML"),
    disableWebPagePreview: z.boolean().default(true),
    commandPollMs: PositiveInt,
    apiBaseUrl: z.string().url().default("https://api.telegram.org"),
    requestTimeoutMs: PositiveInt.default(15000),
    maxRetries: NonNegativeInt.max(10).default(3),
    retryBaseDelayMs: PositiveInt.default(500),
    retryMaxDelayMs: PositiveInt.default(5000),
    getUpdatesLongPollSeconds: NonNegativeInt.max(50).default(0),
    preferIpv4: z.boolean().default(false)
  }),
  manualExecution: z.object({
    enabled: z.boolean().default(true),
    pendingPollMs: PositiveInt.default(5000),
    autoRefreshMinutes: PositiveInt.default(60),
    reconcileLookbackMinutes: PositiveInt.default(60)
  }),
  supabase: z.object({
    enabled: z.boolean(),
    schema: z.string().min(1).default("public")
  })
});

export const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SCHEMA: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  MEXC_API_KEY: z.string().optional(),
  MEXC_API_SECRET: z.string().optional()
});

export type FileConfig = z.infer<typeof FileConfigSchema>;
export type EnvConfig = z.infer<typeof EnvSchema>;

export type RuntimeConfig = FileConfig & {
  env: {
    nodeEnv: string;
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    telegramBotToken: string;
    telegramChatId: string;
    mexcApiKey: string;
    mexcApiSecret: string;
  };
};
