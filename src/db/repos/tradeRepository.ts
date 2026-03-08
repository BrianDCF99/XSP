/**
 * Persists entry/exit/funding/liquidation trade events.
 */
import { PositionEvent } from "../../strategies/types.js";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";
import { mapClosePositionPatch } from "./trade/closePositionPatchMapper.js";
import { mapOpenPositionRow } from "./trade/openPositionRowMapper.js";
import { mapPositionEventRow } from "./trade/positionEventRowMapper.js";

export interface OpenPositionRecord {
  id: string;
  strategyName: string;
  symbol: string;
  exchange: string;
  side: "LONG" | "SHORT";
  entryTime: string;
  entryPrice: number;
  qty: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  netFundingUsd: number | null;
  takeProfitPrice: number | null;
  entrySellRatio: number | null;
  entrySlippageBps: number | null;
}

export interface StrategyPositionStats {
  winners: number;
  losers: number;
  liquidations: number;
  replaced: number;
  realizedPnlUsd: number;
  netFundingUsd: number;
  entries: number;
  exits: number;
}

export interface SymbolPerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  liquidations: number;
  winPct: number;
  totalPnlUsd: number;
  totalFundingUsd: number;
}

export class TradeRepository {
  constructor(private readonly db: LiveTraderSupabaseClient | null) {}

  async insertPositionEvents(cycleRunId: string, events: PositionEvent[]): Promise<void> {
    if (!this.db || events.length === 0) return;

    const rows = events.map((event) => mapPositionEventRow(cycleRunId, event));
    const { error } = await this.db.from("position_events").insert(rows);

    if (error) {
      throw new Error(`Failed to insert position_events: ${error.message}`);
    }
  }

  async applyPositionState(events: PositionEvent[]): Promise<void> {
    if (!this.db || events.length === 0) return;

    for (const event of events) {
      await this.applyOnePositionEvent(event);
    }
  }

  async getOpenPositions(): Promise<OpenPositionRecord[]> {
    if (!this.db) return [];

    const { data, error } = await this.db
      .from("positions")
      .select(
        "id,strategy_name,symbol,exchange,side,entry_time,entry_price,qty,leverage,margin_usd,notional_usd,funding_usd,take_profit_price,entry_sell_ratio,entry_slippage_bps"
      )
      .eq("status", "OPEN");

    if (error) {
      throw new Error(`Failed to query positions open positions: ${error.message}`);
    }

    return this.mapOpenPositionRows(data ?? []);
  }

  async getOpenPositionsByStrategy(strategyName: string): Promise<OpenPositionRecord[]> {
    if (!this.db) return [];

    const { data, error } = await this.db
      .from("positions")
      .select(
        "id,strategy_name,symbol,exchange,side,entry_time,entry_price,qty,leverage,margin_usd,notional_usd,funding_usd,take_profit_price,entry_sell_ratio,entry_slippage_bps"
      )
      .eq("strategy_name", strategyName)
      .eq("status", "OPEN");

    if (error) {
      throw new Error(`Failed to query positions open positions by strategy: ${error.message}`);
    }

    return this.mapOpenPositionRows(data ?? []);
  }

  async getStrategyPositionStats(strategyName: string): Promise<StrategyPositionStats> {
    if (!this.db) {
      return {
        winners: 0,
        losers: 0,
        liquidations: 0,
        replaced: 0,
        realizedPnlUsd: 0,
        netFundingUsd: 0,
        entries: 0,
        exits: 0
      };
    }

    const [positionsResult, entriesResult, exitsResult] = await Promise.all([
      this.db
        .from("positions")
        .select("status,pnl_usd,funding_usd")
        .eq("strategy_name", strategyName),
      this.db
        .from("position_events")
        .select("id", { count: "exact", head: true })
        .eq("strategy_name", strategyName)
        .eq("event_type", "ENTRY"),
      this.db
        .from("position_events")
        .select("id", { count: "exact", head: true })
        .eq("strategy_name", strategyName)
        .in("event_type", ["EXIT", "REPLACE", "LIQUIDATION"])
    ]);

    if (positionsResult.error) {
      throw new Error(`Failed to query positions strategy stats: ${positionsResult.error.message}`);
    }
    if (entriesResult.error) {
      throw new Error(`Failed to count position_events entries: ${entriesResult.error.message}`);
    }
    if (exitsResult.error) {
      throw new Error(`Failed to count position_events exits: ${exitsResult.error.message}`);
    }

    let winners = 0;
    let losers = 0;
    let liquidations = 0;
    let replaced = 0;
    let realizedPnlUsd = 0;
    let netFundingUsd = 0;

    for (const row of positionsResult.data ?? []) {
      const status = String(row.status);
      const pnlUsd = Number(row.pnl_usd ?? 0);
      const fundingUsd = Number(row.funding_usd ?? 0);

      if (Number.isFinite(fundingUsd)) {
        netFundingUsd += fundingUsd;
      }

      if (status === "CLOSED" || status === "REPLACED" || status === "LIQUIDATED") {
        if (Number.isFinite(pnlUsd)) {
          realizedPnlUsd += pnlUsd;
        }
        if (pnlUsd > 0) {
          winners += 1;
        } else {
          losers += 1;
        }
      }

      if (status === "REPLACED") {
        replaced += 1;
      }
      if (status === "LIQUIDATED") {
        liquidations += 1;
      }
    }

    return {
      winners,
      losers,
      liquidations,
      replaced,
      realizedPnlUsd,
      netFundingUsd,
      entries: Number(entriesResult.count ?? 0),
      exits: Number(exitsResult.count ?? 0)
    };
  }

  async getSymbolPerformanceSummary(strategyName: string, symbol: string): Promise<SymbolPerformanceSummary> {
    if (!this.db) {
      return {
        trades: 0,
        wins: 0,
        losses: 0,
        liquidations: 0,
        winPct: 0,
        totalPnlUsd: 0,
        totalFundingUsd: 0
      };
    }

    const normalizedSymbol = symbol.trim().toUpperCase();
    const { data, error } = await this.db
      .from("positions")
      .select("status,pnl_usd,funding_usd")
      .eq("strategy_name", strategyName)
      .eq("symbol", normalizedSymbol);

    if (error) {
      throw new Error(`Failed to query symbol performance summary: ${error.message}`);
    }

    const closedStatuses = new Set(["CLOSED", "REPLACED", "LIQUIDATED"]);
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let liquidations = 0;
    let totalPnlUsd = 0;
    let totalFundingUsd = 0;

    for (const row of data ?? []) {
      const status = String(row.status ?? "").toUpperCase();
      const pnlUsd = Number(row.pnl_usd ?? 0);
      const fundingUsd = Number(row.funding_usd ?? 0);

      if (Number.isFinite(fundingUsd)) {
        totalFundingUsd += fundingUsd;
      }

      if (!closedStatuses.has(status)) continue;

      trades += 1;
      if (Number.isFinite(pnlUsd)) {
        totalPnlUsd += pnlUsd;
      }

      if (pnlUsd > 0) {
        wins += 1;
      } else {
        losses += 1;
      }

      if (status === "LIQUIDATED") {
        liquidations += 1;
      }
    }

    const winPct = trades > 0 ? (wins / trades) * 100 : 0;

    return {
      trades,
      wins,
      losses,
      liquidations,
      winPct,
      totalPnlUsd,
      totalFundingUsd
    };
  }

  private async applyOnePositionEvent(event: PositionEvent): Promise<void> {
    if (event.type === "FUNDING") {
      await this.applyFundingToOpenPosition(event);
      return;
    }
    if (event.type === "ENTRY") {
      await this.insertOpenPosition(event);
      return;
    }

    await this.closeOpenPosition(event);
  }

  private async insertOpenPosition(event: PositionEvent): Promise<void> {
    const open = await this.db!
      .from("positions")
      .select("id")
      .eq("strategy_name", event.strategyName)
      .eq("symbol", event.symbol)
      .eq("status", "OPEN")
      .limit(1)
      .maybeSingle();

    if (open.error) {
      throw new Error(`Failed to query positions open state: ${open.error.message}`);
    }

    if (open.data?.id) return;

    const row = mapOpenPositionRow(event);
    const { error } = await this.db!.from("positions").insert(row);

    if (error) {
      throw new Error(`Failed to insert positions: ${error.message}`);
    }
  }

  private async closeOpenPosition(event: PositionEvent): Promise<void> {
    const patch = mapClosePositionPatch(event);

    const { error } = await this.db!
      .from("positions")
      .update(patch)
      .eq("strategy_name", event.strategyName)
      .eq("symbol", event.symbol)
      .eq("status", "OPEN");

    if (error) {
      throw new Error(`Failed to close positions: ${error.message}`);
    }
  }

  private async applyFundingToOpenPosition(event: PositionEvent): Promise<void> {
    const fundingDelta = event.fundingUsd ?? 0;
    if (!Number.isFinite(fundingDelta) || fundingDelta === 0) return;

    const current = await this.db!
      .from("positions")
      .select("funding_usd")
      .eq("strategy_name", event.strategyName)
      .eq("symbol", event.symbol)
      .eq("status", "OPEN")
      .limit(1)
      .maybeSingle();

    if (current.error) {
      throw new Error(`Failed to query positions funding_usd: ${current.error.message}`);
    }

    const currentFundingUsd = Number(current.data?.funding_usd ?? 0);
    const nextFundingUsd = currentFundingUsd + fundingDelta;

    const { error } = await this.db!
      .from("positions")
      .update({
        funding_usd: nextFundingUsd
      })
      .eq("strategy_name", event.strategyName)
      .eq("symbol", event.symbol)
      .eq("status", "OPEN");

    if (error) {
      throw new Error(`Failed to update positions funding_usd: ${error.message}`);
    }
  }

  async updateOpenPositionTakeProfitPrice(strategyName: string, symbol: string, takeProfitPrice: number): Promise<void> {
    if (!this.db) return;

    if (!Number.isFinite(takeProfitPrice) || takeProfitPrice <= 0) return;

    const { error } = await this.db
      .from("positions")
      .update({
        take_profit_price: takeProfitPrice
      })
      .eq("strategy_name", strategyName)
      .eq("symbol", symbol)
      .eq("status", "OPEN");

    if (error) {
      throw new Error(`Failed to update positions take_profit_price: ${error.message}`);
    }
  }

  private mapOpenPositionRows(rows: any[]): OpenPositionRecord[] {
    return rows.map((row) => ({
      id: String(row.id),
      strategyName: String(row.strategy_name),
      symbol: String(row.symbol),
      exchange: String(row.exchange),
      side: (String(row.side) as "LONG" | "SHORT"),
      entryTime: String(row.entry_time),
      entryPrice: Number(row.entry_price),
      qty: Number(row.qty ?? 0),
      leverage: Number(row.leverage ?? 0),
      marginUsd: Number(row.margin_usd ?? 0),
      notionalUsd: Number(row.notional_usd ?? 0),
      netFundingUsd: row.funding_usd === null ? null : Number(row.funding_usd),
      takeProfitPrice: row.take_profit_price === null ? null : Number(row.take_profit_price),
      entrySellRatio: row.entry_sell_ratio === null ? null : Number(row.entry_sell_ratio),
      entrySlippageBps: row.entry_slippage_bps === null || row.entry_slippage_bps === undefined ? null : Number(row.entry_slippage_bps)
    }));
  }
}
