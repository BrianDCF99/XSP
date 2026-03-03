/**
 * Builds stable dedupe keys for collector cursor state.
 */
export function buildCursorKey(endpointName: string, symbol: string): string {
  return `${endpointName}::${symbol}`;
}
