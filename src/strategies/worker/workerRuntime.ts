/**
 * Resolves worker runtime files/flags for ts/js execution modes.
 */

function nodeMajorVersion(): number {
  const raw = process.versions.node.split(".")[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveWorkerFileUrl(baseImportMetaUrl: string): URL {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  return runningTs
    ? new URL("./strategyWorker.ts", baseImportMetaUrl)
    : new URL("./strategyWorker.js", baseImportMetaUrl);
}

export function resolveWorkerExecArgv(baseImportMetaUrl: string, strategyModulePath: string): string[] {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  const strategyIsTs = strategyModulePath.endsWith(".ts");
  if (!runningTs && !strategyIsTs) return [];

  // Node 20 workers do not consistently honor --import hooks for .ts entrypoints.
  // Use --loader tsx for Node <=20 and --import tsx for newer runtimes.
  return nodeMajorVersion() >= 21 ? ["--import", "tsx"] : ["--loader", "tsx"];
}
