/**
 * Builds patch payload for closing open positions.
 */
import { PositionEvent } from "../../../strategies/types.js";
import { toClosedStatus } from "./positionStatusFromEvent.js";

export function mapClosePositionPatch(event: PositionEvent) {
  return {
    status: toClosedStatus(event.type),
    exit_time: event.eventTime,
    exit_price: event.price,
    pnl_pct: event.pnlPct ?? null,
    pnl_usd: event.pnlUsd ?? null,
    reason: event.reason ?? null,
    funding_usd: event.fundingUsd ?? null,
    exit_slippage_bps: event.exitSlippageBps ?? null,
    roundtrip_slippage_bps: event.roundtripSlippageBps ?? null
  };
}
