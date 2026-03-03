/**
 * Resolves archive worker runtime file and exec flags for ts/js runs.
 */
export function resolveCollectorWorkerFileUrl(baseImportMetaUrl: string): URL {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  return runningTs
    ? new URL("./collectorWorker.ts", baseImportMetaUrl)
    : new URL("./collectorWorker.js", baseImportMetaUrl);
}

export function resolveCollectorWorkerExecArgv(baseImportMetaUrl: string): string[] {
  const runningTs = baseImportMetaUrl.endsWith(".ts");
  return runningTs ? ["--import", "tsx"] : [];
}
