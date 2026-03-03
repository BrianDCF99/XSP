/**
 * Builds exit/liquidation events from boot reconciliation decisions.
 */
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";
import { PositionEvent } from "../../strategies/types.js";

function shortUnleveredPct(entryPrice: number, exitPrice: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) return 0;
  return ((entryPrice - exitPrice) / entryPrice) * 100;
}

function leveragedPct(unleveredPct: number, leverage: number): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return unleveredPct * leverage;
}

function pnlUsd(marginUsd: number, leverage: number, unleveredPct: number): number {
  if (!Number.isFinite(marginUsd) || !Number.isFinite(leverage)) return 0;
  return marginUsd * leverage * (unleveredPct / 100);
}

export function buildBootCloseEvent(
  position: OpenPositionRecord,
  closeType: "EXIT" | "LIQUIDATION",
  reason: "TP_BOOT_RECON" | "LIQ_BOOT_RECON",
  exitPrice: number,
  eventTimeIso: string
): PositionEvent {
  const unlev = shortUnleveredPct(position.entryPrice, exitPrice);
  const lev = leveragedPct(unlev, position.leverage);
  const maybeTp = position.takeProfitPrice === null ? {} : { takeProfitPrice: position.takeProfitPrice };

  return {
    type: closeType,
    strategyName: position.strategyName,
    symbol: position.symbol,
    exchange: position.exchange,
    side: position.side,
    eventTime: eventTimeIso,
    price: exitPrice,
    qty: position.qty,
    leverage: position.leverage,
    marginUsd: position.marginUsd,
    notionalUsd: position.notionalUsd,
    pnlPct: lev,
    pnlUsd: pnlUsd(position.marginUsd, position.leverage, unlev),
    reason,
    ...maybeTp
  };
}
