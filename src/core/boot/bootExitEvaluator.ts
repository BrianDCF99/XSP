/**
 * Decides whether an open position should be closed during boot reconciliation.
 */
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";

export interface BootExitDecision {
  shouldClose: boolean;
  reason: "TP_BOOT_RECON" | "LIQ_BOOT_RECON" | null;
  closeAs: "EXIT" | "LIQUIDATION" | null;
}

function isTpHit(position: OpenPositionRecord, price: number): boolean {
  if (position.side !== "SHORT") return false;
  if (position.takeProfitPrice === null) return false;
  return price <= position.takeProfitPrice;
}

function isLiqHit(position: OpenPositionRecord, price: number): boolean {
  if (position.side !== "SHORT") return false;
  if (!Number.isFinite(position.leverage) || position.leverage <= 0) return false;
  const liqPrice = position.entryPrice * (1 + 1 / position.leverage);
  return price >= liqPrice;
}

export function evaluateBootExit(position: OpenPositionRecord, currentPrice: number): BootExitDecision {
  if (isTpHit(position, currentPrice)) {
    return {
      shouldClose: true,
      reason: "TP_BOOT_RECON",
      closeAs: "EXIT"
    };
  }

  if (isLiqHit(position, currentPrice)) {
    return {
      shouldClose: true,
      reason: "LIQ_BOOT_RECON",
      closeAs: "LIQUIDATION"
    };
  }

  return {
    shouldClose: false,
    reason: null,
    closeAs: null
  };
}
