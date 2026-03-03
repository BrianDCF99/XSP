/**
 * Computes an inclusive last-N-minutes window for backfill requests.
 */
import { MinuteWindow } from "../types.js";

const MINUTE_MS = 60_000;

export function computeMinuteWindow(nowMs: number, lookbackMinutes: number): MinuteWindow {
  const safeLookback = Math.max(1, Math.floor(lookbackMinutes));

  // Use only fully closed minutes.
  const latestClosedMinuteMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
  const startMs = latestClosedMinuteMs - (safeLookback - 1) * MINUTE_MS;

  return {
    startMs,
    endMs: latestClosedMinuteMs,
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor(latestClosedMinuteMs / 1000)
  };
}

export function toMinuteBucketMs(inputMs: number): number {
  return Math.floor(inputMs / MINUTE_MS) * MINUTE_MS;
}
