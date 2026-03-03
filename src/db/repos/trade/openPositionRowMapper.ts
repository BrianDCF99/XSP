/**
 * Builds row payload for opening positions.
 */
import { randomUUID } from "node:crypto";
import { PositionEvent } from "../../../strategies/types.js";

export function mapOpenPositionRow(event: PositionEvent) {
  return {
    id: randomUUID(),
    strategy_name: event.strategyName,
    symbol: event.symbol,
    exchange: event.exchange,
    side: event.side,
    entry_time: event.eventTime,
    entry_price: event.price,
    qty: event.qty ?? null,
    leverage: event.leverage ?? null,
    margin_usd: event.marginUsd ?? null,
    notional_usd: event.notionalUsd ?? null,
    take_profit_price: event.takeProfitPrice ?? null,
    entry_sell_ratio: event.entrySellRatio ?? null,
    entry_slippage_bps: event.entrySlippageBps ?? null,
    status: "OPEN"
  };
}
