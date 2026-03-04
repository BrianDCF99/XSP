/**
 * Persists top-level cycle run state.
 */
import { randomUUID } from "node:crypto";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";

export class RunRepository {
  constructor(private readonly db: LiveTraderSupabaseClient | null) {}

  async create(exchange: string): Promise<string> {
    const id = randomUUID();
    if (!this.db) return id;

    const { error } = await this.db.from("runs").insert({
      id,
      exchange,
      status: "RUNNING",
      started_at: new Date().toISOString()
    });

    if (error) {
      throw new Error(`Failed to insert runs: ${error.message}`);
    }

    return id;
  }

  async finish(id: string, status: "SUCCESS" | "FAILED", errorMessage?: string): Promise<void> {
    if (!this.db) return;

    const { error } = await this.db
      .from("runs")
      .update({
        status,
        error_message: errorMessage ?? null,
        finished_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update runs: ${error.message}`);
    }
  }
}
