/**
 * Loads and validates YAML + environment variables.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { assertExchangeExists, assertRequiredSecrets, assertStrategyFoldersConfigured } from "./configAssertions.js";
import { buildRuntimeConfig } from "./runtimeConfigBuilder.js";
import { EnvSchema, FileConfigSchema, RuntimeConfig } from "./schema.js";

dotenv.config();

function readRawConfig(configPath: string): string {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }
  return fs.readFileSync(configPath, "utf8");
}

export function loadConfig(configPath = path.resolve(process.cwd(), "config.yaml")): RuntimeConfig {
  const rawFile = readRawConfig(configPath);
  const parsedYaml = YAML.parse(rawFile);
  const fileConfig = FileConfigSchema.parse(parsedYaml);
  const env = EnvSchema.parse(process.env);

  assertExchangeExists(fileConfig.exchange.active, fileConfig.exchange.exchanges);
  assertStrategyFoldersConfigured(fileConfig.strategies.active);

  const runtimeConfig = buildRuntimeConfig(fileConfig, env);
  assertRequiredSecrets(runtimeConfig);
  return runtimeConfig;
}
