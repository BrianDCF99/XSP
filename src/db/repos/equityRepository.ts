/**
 * Persists account/equity state snapshots emitted by strategies.
 */
import { AccountSnapshotEvent } from "../../strategies/types.js";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";

export interface AccountSnapshotRecord {
  observedAt: string;
  equityUsd: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  winners: number;
  losers: number;
  liquidations: number;
  replaced: number;
  entries: number;
  exits: number;
  openPositions: number;
  missed: number;
  netFundingUsd: number;
}

export class EquityRepository {
  constructor(private readonly db: LiveTraderSupabaseClient | null) {}

  async insert(snapshot: AccountSnapshotEvent): Promise<void> {
    if (!this.db) return;

    const { error } = await this.db.from("lt_account_snapshots").insert({
      strategy_name: snapshot.strategyName,
      observed_at: snapshot.observedAt,
      equity_usd: snapshot.equityUsd,
      cash_usd: snapshot.cashUsd,
      margin_in_use_usd: snapshot.marginInUseUsd,
      open_notional_usd: snapshot.openNotionalUsd,
      unrealized_pnl_usd: snapshot.unrealizedPnlUsd,
      realized_pnl_usd: snapshot.realizedPnlUsd,
      winners: snapshot.winners,
      losers: snapshot.losers,
      liquidations: snapshot.liquidations,
      replaced: snapshot.replaced,
      entries: snapshot.entries,
      exits: snapshot.exits,
      open_positions: snapshot.openPositions,
      missed: snapshot.missed,
      net_funding_usd: snapshot.netFundingUsd
    });

    if (error) {
      throw new Error(`Failed to insert lt_account_snapshots: ${error.message}`);
    }
  }

  async getLatestByStrategy(strategyName: string): Promise<{ observedAt: string; equityUsd: number; cashUsd: number } | null> {
    if (!this.db) return null;

    const { data, error } = await this.db
      .from("lt_account_snapshots")
      .select("observed_at,equity_usd,cash_usd")
      .eq("strategy_name", strategyName)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query latest lt_account_snapshots: ${error.message}`);
    }

    if (!data) return null;

    return {
      observedAt: String(data.observed_at),
      equityUsd: Number(data.equity_usd),
      cashUsd: Number(data.cash_usd)
    };
  }

  async getFirstByStrategy(strategyName: string): Promise<{ observedAt: string; equityUsd: number; cashUsd: number } | null> {
    if (!this.db) return null;

    const { data, error } = await this.db
      .from("lt_account_snapshots")
      .select("observed_at,equity_usd,cash_usd")
      .eq("strategy_name", strategyName)
      .order("observed_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query first lt_account_snapshots: ${error.message}`);
    }

    if (!data) return null;

    return {
      observedAt: String(data.observed_at),
      equityUsd: Number(data.equity_usd),
      cashUsd: Number(data.cash_usd)
    };
  }

  async getLatestSnapshotByStrategy(strategyName: string): Promise<AccountSnapshotRecord | null> {
    if (!this.db) return null;

    const { data, error } = await this.db
      .from("lt_account_snapshots")
      .select(
        "observed_at,equity_usd,cash_usd,margin_in_use_usd,open_notional_usd,unrealized_pnl_usd,realized_pnl_usd,winners,losers,liquidations,replaced,entries,exits,open_positions,missed,net_funding_usd"
      )
      .eq("strategy_name", strategyName)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query latest strategy account snapshot: ${error.message}`);
    }

    if (!data) return null;

    return {
      observedAt: String(data.observed_at),
      equityUsd: Number(data.equity_usd),
      cashUsd: Number(data.cash_usd),
      marginInUseUsd: Number(data.margin_in_use_usd),
      openNotionalUsd: Number(data.open_notional_usd),
      unrealizedPnlUsd: Number(data.unrealized_pnl_usd),
      realizedPnlUsd: Number(data.realized_pnl_usd),
      winners: Number(data.winners),
      losers: Number(data.losers),
      liquidations: Number(data.liquidations),
      replaced: Number(data.replaced),
      entries: Number(data.entries),
      exits: Number(data.exits),
      openPositions: Number(data.open_positions),
      missed: Number(data.missed),
      netFundingUsd: Number(data.net_funding_usd)
    };
  }
}
