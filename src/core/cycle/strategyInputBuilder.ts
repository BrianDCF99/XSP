/**
 * Builds per-strategy worker input payload.
 */
import { FuturesSnapshot } from "../../exchange/types.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { PreviousAccountSnapshot, StrategyOpenPosition, StrategyWorkerInput } from "../../strategies/types.js";
import { nowIso } from "../../utils/time.js";

export function buildStrategyInput(
  runId: string,
  strategyName: string,
  snapshot: FuturesSnapshot,
  tickerDeepLinkTemplate: string,
  openPositions: StrategyOpenPosition[],
  previousAccountSnapshot: PreviousAccountSnapshot | null,
  exchangeAccount: ExchangeAccountState | null
): StrategyWorkerInput {
  return {
    runId,
    strategyName,
    exchange: snapshot.exchange,
    nowIso: nowIso(),
    tickerDeepLinkTemplate,
    snapshot,
    openPositions,
    previousAccountSnapshot,
    exchangeAccount
  };
}
