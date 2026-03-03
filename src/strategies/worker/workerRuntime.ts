/**
 * Resolves worker runtime files/flags for ts/js execution modes.
 */

export function resolveWorkerFileUrl(baseImportMetaUrl: string): URL {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  return runningTs
    ? new URL("./strategyWorker.ts", baseImportMetaUrl)
    : new URL("./strategyWorker.js", baseImportMetaUrl);
}

export function resolveWorkerExecArgv(baseImportMetaUrl: string, strategyModulePath: string): string[] {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  const strategyIsTs = strategyModulePath.endsWith(".ts");
  return runningTs || strategyIsTs ? ["--import", "tsx"] : [];
}
