/**
 * Persists strategy-level run metadata and outbound messages.
 */
import { randomUUID } from "node:crypto";
import { StrategyMessage } from "../../strategies/types.js";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";
import { mapMessageRows } from "./strategy/messageRows.js";
import { mapTrackedSymbolRows } from "./strategy/trackedSymbolRows.js";

export interface StrategyMessageWithDelivery {
  message: StrategyMessage;
  telegramMessageId: number | null;
}

export class StrategyRepository {
  constructor(private readonly db: LiveTraderSupabaseClient | null) {}

  async startRun(runId: string, strategyName: string): Promise<string> {
    const id = randomUUID();
    if (!this.db) return id;

    const { error } = await this.db.from("strategy_runs").insert({
      id,
      run_id: runId,
      strategy_name: strategyName,
      status: "RUNNING",
      started_at: new Date().toISOString()
    });

    if (error) {
      throw new Error(`Failed to insert strategy_runs: ${error.message}`);
    }

    return id;
  }

  async finishRun(runId: string, status: "SUCCESS" | "FAILED", errorMessage?: string): Promise<void> {
    if (!this.db) return;

    const { error } = await this.db
      .from("strategy_runs")
      .update({
        status,
        error_message: errorMessage ?? null,
        finished_at: new Date().toISOString()
      })
      .eq("id", runId);

    if (error) {
      throw new Error(`Failed to update strategy_runs: ${error.message}`);
    }
  }

  async insertMessages(
    cycleRunId: string,
    strategyRunId: string,
    strategyName: string,
    records: StrategyMessageWithDelivery[]
  ): Promise<void> {
    if (!this.db || records.length === 0) return;

    const rows = mapMessageRows(cycleRunId, strategyRunId, strategyName, records);
    const { error } = await this.db.from("strategy_messages").insert(rows);

    if (error) {
      throw new Error(`Failed to insert strategy_messages: ${error.message}`);
    }
  }

  async upsertTrackedSymbols(strategyName: string, symbols: string[]): Promise<void> {
    if (!this.db || symbols.length === 0) return;

    const rows = mapTrackedSymbolRows(strategyName, symbols, new Date().toISOString());
    const { error } = await this.db.from("tracked_symbols").upsert(rows, {
      onConflict: "strategy_name,symbol"
    });

    if (error) {
      throw new Error(`Failed to upsert tracked_symbols: ${error.message}`);
    }
  }

  async getTrackedSymbols(strategyName: string): Promise<string[]> {
    if (!this.db) return [];

    const { data, error } = await this.db
      .from("tracked_symbols")
      .select("symbol")
      .eq("strategy_name", strategyName);

    if (error) {
      throw new Error(`Failed to query tracked_symbols: ${error.message}`);
    }

    return (data ?? []).map((row) => String(row.symbol));
  }
}
