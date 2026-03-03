/**
 * Maps tracked symbols to upsert row payloads.
 */
export function mapTrackedSymbolRows(strategyName: string, symbols: string[], nowIso: string) {
  return symbols.map((symbol) => ({
    strategy_name: strategyName,
    symbol,
    updated_at: nowIso
  }));
}
