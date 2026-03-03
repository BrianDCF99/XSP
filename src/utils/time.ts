/**
 * Time helpers shared by scheduler and message formatters.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function computeNextTickMs(
  fromMs: number,
  cadence: { unit: "minute" | "hour"; every: number; offsetSeconds: number }
): number {
  const periodSec = cadence.unit === "minute" ? cadence.every * 60 : cadence.every * 3600;
  const nowSec = Math.floor(fromMs / 1000);
  const currentWindowStart = Math.floor(nowSec / periodSec) * periodSec;
  let candidateSec = currentWindowStart + cadence.offsetSeconds;

  if (candidateSec <= nowSec) {
    candidateSec += periodSec;
  }

  return candidateSec * 1000;
}

export function formatEntryAge(entryAtMs: number, nowMs: number): string {
  const diffMs = Math.max(0, nowMs - entryAtMs);
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return `${String(days).padStart(2, "0")}-${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
