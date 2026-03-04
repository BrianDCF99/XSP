/**
 * Persists actionable telegram alerts and their manual resolution state.
 */
import { randomUUID } from "node:crypto";
import { ManualAlertButtonAction, ManualAlertKind } from "../../strategies/types.js";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";

export interface ManualAlertCreateInput {
  cycleRunId: string;
  strategyName: string;
  kind: ManualAlertKind;
  primarySymbol: string;
  secondarySymbol?: string;
  reason?: string;
  payload: Record<string, unknown>;
}

export interface ManualAlertRecord {
  id: string;
  cycleRunId: string | null;
  strategyName: string;
  kind: ManualAlertKind;
  primarySymbol: string;
  secondarySymbol: string | null;
  reason: string | null;
  status: string;
  requestedAction: ManualAlertButtonAction | null;
  payload: Record<string, unknown>;
  telegramMessageId: number | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  confirmedAt: string | null;
}

export class ManualAlertRepository {
  constructor(private readonly db: LiveTraderSupabaseClient | null) {}

  async create(input: ManualAlertCreateInput): Promise<string> {
    const id = randomUUID();
    if (!this.db) return id;

    const { error } = await this.db.from("manual_alerts").insert({
      id,
      cycle_run_id: input.cycleRunId,
      strategy_name: input.strategyName,
      kind: input.kind,
      primary_symbol: input.primarySymbol,
      secondary_symbol: input.secondarySymbol ?? null,
      reason: input.reason ?? null,
      status: "PENDING",
      payload: input.payload
    });

    if (error) {
      throw new Error(`Failed to insert manual_alerts: ${error.message}`);
    }

    return id;
  }

  async setTelegramMessageId(alertId: string, telegramMessageId: number | null): Promise<void> {
    if (!this.db) return;

    const { error } = await this.db
      .from("manual_alerts")
      .update({
        telegram_message_id: telegramMessageId,
        updated_at: new Date().toISOString()
      })
      .eq("id", alertId);

    if (error) {
      throw new Error(`Failed to update manual_alerts telegram_message_id: ${error.message}`);
    }
  }

  async getById(alertId: string): Promise<ManualAlertRecord | null> {
    if (!this.db) return null;

    const { data, error } = await this.db
      .from("manual_alerts")
      .select(
        "id,cycle_run_id,strategy_name,kind,primary_symbol,secondary_symbol,reason,status,requested_action,payload,telegram_message_id,attempts,last_error,created_at,updated_at,last_checked_at,confirmed_at"
      )
      .eq("id", alertId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query manual_alerts by id: ${error.message}`);
    }

    if (!data) return null;

    return {
      id: String(data.id),
      cycleRunId: data.cycle_run_id ? String(data.cycle_run_id) : null,
      strategyName: String(data.strategy_name),
      kind: String(data.kind) as ManualAlertKind,
      primarySymbol: String(data.primary_symbol),
      secondarySymbol: data.secondary_symbol ? String(data.secondary_symbol) : null,
      reason: data.reason ? String(data.reason) : null,
      status: String(data.status),
      requestedAction: data.requested_action ? (String(data.requested_action) as ManualAlertButtonAction) : null,
      payload: (data.payload ?? {}) as Record<string, unknown>,
      telegramMessageId: data.telegram_message_id === null ? null : Number(data.telegram_message_id),
      attempts: Number(data.attempts ?? 0),
      lastError: data.last_error ? String(data.last_error) : null,
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
      lastCheckedAt: data.last_checked_at ? String(data.last_checked_at) : null,
      confirmedAt: data.confirmed_at ? String(data.confirmed_at) : null
    };
  }

  async markWaiting(alertId: string, action: ManualAlertButtonAction, errorText?: string): Promise<void> {
    if (!this.db) return;

    const patch: Record<string, unknown> = {
      status: "WAITING",
      requested_action: action,
      updated_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString()
    };

    if (errorText) {
      patch.last_error = errorText;
    }

    const { error } = await this.db.from("manual_alerts").update(patch).eq("id", alertId);

    if (error) {
      throw new Error(`Failed to update manual_alerts waiting state: ${error.message}`);
    }
  }

  async markConfirmed(alertId: string, action: ManualAlertButtonAction): Promise<void> {
    if (!this.db) return;

    const nowIso = new Date().toISOString();
    const { error } = await this.db
      .from("manual_alerts")
      .update({
        status: "CONFIRMED",
        requested_action: action,
        updated_at: nowIso,
        confirmed_at: nowIso,
        last_checked_at: nowIso,
        last_error: null
      })
      .eq("id", alertId);

    if (error) {
      throw new Error(`Failed to update manual_alerts confirmed state: ${error.message}`);
    }
  }

  async incrementAttempt(alertId: string, errorText?: string): Promise<void> {
    if (!this.db) return;

    const current = await this.getById(alertId);
    if (!current) return;

    const { error } = await this.db
      .from("manual_alerts")
      .update({
        attempts: current.attempts + 1,
        last_error: errorText ?? current.lastError,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", alertId);

    if (error) {
      throw new Error(`Failed to increment manual_alerts attempts: ${error.message}`);
    }
  }

  async listWaiting(limit = 100): Promise<ManualAlertRecord[]> {
    if (!this.db) return [];

    const { data, error } = await this.db
      .from("manual_alerts")
      .select(
        "id,cycle_run_id,strategy_name,kind,primary_symbol,secondary_symbol,reason,status,requested_action,payload,telegram_message_id,attempts,last_error,created_at,updated_at,last_checked_at,confirmed_at"
      )
      .eq("status", "WAITING")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to query waiting manual_alerts: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: String(row.id),
      cycleRunId: row.cycle_run_id ? String(row.cycle_run_id) : null,
      strategyName: String(row.strategy_name),
      kind: String(row.kind) as ManualAlertKind,
      primarySymbol: String(row.primary_symbol),
      secondarySymbol: row.secondary_symbol ? String(row.secondary_symbol) : null,
      reason: row.reason ? String(row.reason) : null,
      status: String(row.status),
      requestedAction: row.requested_action ? (String(row.requested_action) as ManualAlertButtonAction) : null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      telegramMessageId: row.telegram_message_id === null ? null : Number(row.telegram_message_id),
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null
    }));
  }

  async listRecentByStrategy(strategyName: string, minutesLookback: number): Promise<ManualAlertRecord[]> {
    if (!this.db) return [];

    const fromIso = new Date(Date.now() - minutesLookback * 60_000).toISOString();
    const { data, error } = await this.db
      .from("manual_alerts")
      .select(
        "id,cycle_run_id,strategy_name,kind,primary_symbol,secondary_symbol,reason,status,requested_action,payload,telegram_message_id,attempts,last_error,created_at,updated_at,last_checked_at,confirmed_at"
      )
      .eq("strategy_name", strategyName)
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to query recent manual_alerts: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: String(row.id),
      cycleRunId: row.cycle_run_id ? String(row.cycle_run_id) : null,
      strategyName: String(row.strategy_name),
      kind: String(row.kind) as ManualAlertKind,
      primarySymbol: String(row.primary_symbol),
      secondarySymbol: row.secondary_symbol ? String(row.secondary_symbol) : null,
      reason: row.reason ? String(row.reason) : null,
      status: String(row.status),
      requestedAction: row.requested_action ? (String(row.requested_action) as ManualAlertButtonAction) : null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      telegramMessageId: row.telegram_message_id === null ? null : Number(row.telegram_message_id),
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ? String(row.last_error) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      lastCheckedAt: row.last_checked_at ? String(row.last_checked_at) : null,
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null
    }));
  }

  async getLatestByKindAndSymbol(
    strategyName: string,
    kind: ManualAlertKind,
    primarySymbol: string
  ): Promise<ManualAlertRecord | null> {
    if (!this.db) return null;

    const { data, error } = await this.db
      .from("manual_alerts")
      .select(
        "id,cycle_run_id,strategy_name,kind,primary_symbol,secondary_symbol,reason,status,requested_action,payload,telegram_message_id,attempts,last_error,created_at,updated_at,last_checked_at,confirmed_at"
      )
      .eq("strategy_name", strategyName)
      .eq("kind", kind)
      .eq("primary_symbol", primarySymbol)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query latest manual_alerts by kind+symbol: ${error.message}`);
    }

    if (!data) return null;

    return {
      id: String(data.id),
      cycleRunId: data.cycle_run_id ? String(data.cycle_run_id) : null,
      strategyName: String(data.strategy_name),
      kind: String(data.kind) as ManualAlertKind,
      primarySymbol: String(data.primary_symbol),
      secondarySymbol: data.secondary_symbol ? String(data.secondary_symbol) : null,
      reason: data.reason ? String(data.reason) : null,
      status: String(data.status),
      requestedAction: data.requested_action ? (String(data.requested_action) as ManualAlertButtonAction) : null,
      payload: (data.payload ?? {}) as Record<string, unknown>,
      telegramMessageId: data.telegram_message_id === null ? null : Number(data.telegram_message_id),
      attempts: Number(data.attempts ?? 0),
      lastError: data.last_error ? String(data.last_error) : null,
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
      lastCheckedAt: data.last_checked_at ? String(data.last_checked_at) : null,
      confirmedAt: data.confirmed_at ? String(data.confirmed_at) : null
    };
  }

  async countMissedEntries(strategyName: string): Promise<number> {
    if (!this.db) return 0;

    const [totalEntries, openedEntries] = await Promise.all([
      this.db
        .from("manual_alerts")
        .select("id", { count: "exact", head: true })
        .eq("strategy_name", strategyName)
        .in("kind", ["ENTRY_AVAILABLE", "REPLACEMENT_AVAILABLE"]),
      this.db
        .from("manual_alerts")
        .select("id", { count: "exact", head: true })
        .eq("strategy_name", strategyName)
        .in("kind", ["ENTRY_AVAILABLE", "REPLACEMENT_AVAILABLE"])
        .eq("status", "CONFIRMED")
        .eq("requested_action", "OPENED")
    ]);

    if (totalEntries.error) {
      throw new Error(`Failed to count manual_alerts total entries: ${totalEntries.error.message}`);
    }
    if (openedEntries.error) {
      throw new Error(`Failed to count manual_alerts opened entries: ${openedEntries.error.message}`);
    }

    const total = Number(totalEntries.count ?? 0);
    const opened = Number(openedEntries.count ?? 0);
    return Math.max(0, total - opened);
  }
}
