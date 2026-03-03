/**
 * Converts strategy position events to insert rows.
 */
import { PositionEvent } from "../../../strategies/types.js";

export function mapPositionEventRow(cycleRunId: string, event: PositionEvent) {
  return {
    cycle_run_id: cycleRunId,
    strategy_name: event.strategyName,
    symbol: event.symbol,
    exchange: event.exchange,
    side: event.side,
    event_type: event.type,
    event_time: event.eventTime,
    price: event.price,
    qty: event.qty ?? null,
    leverage: event.leverage ?? null,
    margin_usd: event.marginUsd ?? null,
    notional_usd: event.notionalUsd ?? null,
    pnl_pct: event.pnlPct ?? null,
    pnl_usd: event.pnlUsd ?? null,
    reason: event.reason ?? null,
    funding_usd: event.fundingUsd ?? null,
    take_profit_price: event.takeProfitPrice ?? null,
    entry_sell_ratio: event.entrySellRatio ?? null,
    entry_slippage_bps: event.entrySlippageBps ?? null,
    exit_slippage_bps: event.exitSlippageBps ?? null,
    roundtrip_slippage_bps: event.roundtripSlippageBps ?? null
  };
}
