/**
 * Consolidates repository instances for one runtime app.
 */
import { EquityRepository } from "./equityRepository.js";
import { RunRepository } from "./runRepository.js";
import { StrategyRepository } from "./strategyRepository.js";
import { TradeRepository } from "./tradeRepository.js";
import { LiveTraderSupabaseClient } from "../supabaseClient.js";
import { ManualAlertRepository } from "./manualAlertRepository.js";

export interface Repositories {
  runs: RunRepository;
  strategies: StrategyRepository;
  trades: TradeRepository;
  equity: EquityRepository;
  manualAlerts: ManualAlertRepository;
}

export function createRepositories(db: LiveTraderSupabaseClient | null): Repositories {
  return {
    runs: new RunRepository(db),
    strategies: new StrategyRepository(db),
    trades: new TradeRepository(db),
    equity: new EquityRepository(db),
    manualAlerts: new ManualAlertRepository(db)
  };
}
