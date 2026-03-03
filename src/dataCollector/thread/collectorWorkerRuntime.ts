/**
 * Resolves archive worker runtime file and exec flags for ts/js runs.
 */
function nodeMajorVersion(): number {
  const raw = process.versions.node.split(".")[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveCollectorWorkerFileUrl(baseImportMetaUrl: string): URL {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  return runningTs
    ? new URL("./collectorWorker.ts", baseImportMetaUrl)
    : new URL("./collectorWorker.js", baseImportMetaUrl);
}

export function resolveCollectorWorkerExecArgv(baseImportMetaUrl: string): string[] {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  if (!runningTs) return [];

  // Node 20 workers do not consistently honor --import hooks for .ts entrypoints.
  // Use --loader tsx for Node <=20 and --import tsx for newer runtimes.
  return nodeMajorVersion() >= 21 ? ["--import", "tsx"] : ["--loader", "tsx"];
}
