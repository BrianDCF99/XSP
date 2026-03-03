/**
 * Resolves and validates strategy folders listed in config.
 */
import fs from "node:fs";
import path from "node:path";
import { RuntimeConfig } from "../config/schema.js";
import { StrategyDescriptor } from "./types.js";

function resolveStrategyModule(folderPath: string): string {
  const tsPath = path.join(folderPath, "strategy.ts");
  const jsPath = path.join(folderPath, "strategy.js");

  if (fs.existsSync(tsPath)) return tsPath;
  if (fs.existsSync(jsPath)) return jsPath;

  throw new Error(`Missing strategy module: expected strategy.ts or strategy.js in ${folderPath}`);
}

function resolveTelegramModule(folderPath: string): string {
  const tsPath = path.join(folderPath, "telegram.ts");
  const jsPath = path.join(folderPath, "telegram.js");

  if (fs.existsSync(tsPath)) return tsPath;
  if (fs.existsSync(jsPath)) return jsPath;

  throw new Error(`Missing telegram module: expected telegram.ts or telegram.js in ${folderPath}`);
}

function assertRequiredDocs(folderPath: string): { strategyMdPath: string; telegramMdPath: string } {
  const strategyMdPath = path.join(folderPath, "strategy.md");
  const telegramMdPath = path.join(folderPath, "telegram.md");

  if (!fs.existsSync(strategyMdPath)) {
    throw new Error(`Missing strategy.md in ${folderPath}`);
  }
  if (!fs.existsSync(telegramMdPath)) {
    throw new Error(`Missing telegram.md in ${folderPath}`);
  }

  return { strategyMdPath, telegramMdPath };
}

function assertRootTelegramTemplate(basePath: string): void {
  const root = path.resolve(basePath, "..", "TG_Messages.md");
  if (!fs.existsSync(root)) {
    throw new Error(`Missing root TG_Messages.md at ${root}`);
  }
}

export function loadStrategyRegistry(cfg: RuntimeConfig): StrategyDescriptor[] {
  const basePath = path.resolve(process.cwd(), cfg.strategies.basePath);
  assertRootTelegramTemplate(basePath);

  return cfg.strategies.active.map((name) => {
    const folderPath = path.join(basePath, name);
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Strategy folder not found: ${folderPath}`);
    }

    const { strategyMdPath, telegramMdPath } = assertRequiredDocs(folderPath);
    const modulePath = resolveStrategyModule(folderPath);
    const telegramModulePath = resolveTelegramModule(folderPath);

    return {
      name,
      folderPath,
      modulePath,
      strategyMdPath,
      telegramMdPath,
      telegramModulePath
    };
  });
}
