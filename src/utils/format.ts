/**
 * Lightweight number formatting helpers used in Telegram messages.
 */
export function fmtUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(digits)}`;
}

export function fmtPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value.toFixed(digits)}%`;
}

export function fmtBps(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "0.00 bps";
  return `${value.toFixed(digits)} bps`;
}

export function signedUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(digits)}`;
}
