/**
 * Supabase client factory with optional no-db mode.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { RuntimeConfig } from "../config/schema.js";

export type LiveTraderSupabaseClient = SupabaseClient<any, any, any>;

export function createSupabaseClient(cfg: RuntimeConfig): LiveTraderSupabaseClient | null {
  if (!cfg.supabase.enabled) return null;
  return createClient(cfg.env.supabaseUrl, cfg.env.supabaseServiceRoleKey, {
    db: {
      schema: cfg.supabase.schema
    }
  });
}
