/**
 * Persists one strategy account snapshot from live account state + DB aggregates.
 */
import { Repositories } from "../../db/repos/index.js";
import { AccountSnapshotEvent } from "../../strategies/types.js";

const DEFAULT_STARTING_EQUITY_USD = 10_000;

export interface SnapshotAccountState {
  equityUsd?: number;
  cashUsd?: number;
  marginInUseUsd?: number;
  openNotionalUsd?: number;
  unrealizedPnlUsd?: number;
}

function finite(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function sumMargin(openPositions: Array<{ marginUsd: number }>): number {
  return openPositions.reduce((sum, position) => sum + position.marginUsd, 0);
}

function sumNotional(openPositions: Array<{ notionalUsd: number }>): number {
  return openPositions.reduce((sum, position) => sum + position.notionalUsd, 0);
}

export async function captureStrategyAccountSnapshot(input: {
  repos: Repositories;
  strategyName: string;
  observedAt?: string;
  liveAccount?: SnapshotAccountState | null;
  startingEquityUsd?: number;
  strictLiveAccount?: boolean;
}): Promise<void> {
  const { repos, strategyName } = input;
  const observedAt = input.observedAt ?? new Date().toISOString();
  const startingEquityUsd = input.startingEquityUsd ?? DEFAULT_STARTING_EQUITY_USD;
  const live = input.liveAccount ?? null;
  const strictLiveAccount = input.strictLiveAccount === true;

  const [openPositions, positionStats, missed] = await Promise.all([
    repos.trades.getOpenPositionsByStrategy(strategyName),
    repos.trades.getStrategyPositionStats(strategyName),
    repos.manualAlerts.countMissedEntries(strategyName)
  ]);

  const marginDerived = sumMargin(openPositions);
  const notionalDerived = sumNotional(openPositions);

  if (strictLiveAccount) {
    const equityUsd = finite(live?.equityUsd);
    const cashUsd = finite(live?.cashUsd);
    const marginInUseUsd = finite(live?.marginInUseUsd);
    const openNotionalUsd = finite(live?.openNotionalUsd);
    const unrealizedPnlUsd = finite(live?.unrealizedPnlUsd);

    if (
      equityUsd === undefined ||
      cashUsd === undefined ||
      marginInUseUsd === undefined ||
      openNotionalUsd === undefined ||
      unrealizedPnlUsd === undefined
    ) {
      throw new Error("Strict live account snapshot requires equity/cash/margin/notional/unrealized directly from exchange");
    }

    const strictSnapshot: AccountSnapshotEvent = {
      strategyName,
      observedAt,
      equityUsd,
      cashUsd,
      marginInUseUsd,
      openNotionalUsd,
      unrealizedPnlUsd,
      realizedPnlUsd: positionStats.realizedPnlUsd,
      winners: positionStats.winners,
      losers: positionStats.losers,
      liquidations: positionStats.liquidations,
      replaced: positionStats.replaced,
      entries: positionStats.entries,
      exits: positionStats.exits,
      openPositions: openPositions.length,
      missed,
      netFundingUsd: positionStats.netFundingUsd
    };

    await repos.equity.insert(strictSnapshot);
    return;
  }

  const marginInUseUsd = finite(live?.marginInUseUsd) ?? marginDerived;
  const openNotionalUsd = finite(live?.openNotionalUsd) ?? notionalDerived;
  const unrealizedPnlUsd = finite(live?.unrealizedPnlUsd) ?? 0;

  const exchangeEquity = finite(live?.equityUsd);
  const exchangeCash = finite(live?.cashUsd);

  const equityBase = startingEquityUsd + positionStats.realizedPnlUsd + positionStats.netFundingUsd;
  const equityUsd =
    exchangeEquity ??
    (exchangeCash !== undefined ? exchangeCash + marginInUseUsd : equityBase + unrealizedPnlUsd);

  const cashUsd =
    exchangeCash ??
    (exchangeEquity !== undefined ? exchangeEquity - marginInUseUsd : equityUsd - marginInUseUsd);

  const snapshot: AccountSnapshotEvent = {
    strategyName,
    observedAt,
    equityUsd,
    cashUsd,
    marginInUseUsd,
    openNotionalUsd,
    unrealizedPnlUsd,
    realizedPnlUsd: positionStats.realizedPnlUsd,
    winners: positionStats.winners,
    losers: positionStats.losers,
    liquidations: positionStats.liquidations,
    replaced: positionStats.replaced,
    entries: positionStats.entries,
    exits: positionStats.exits,
    openPositions: openPositions.length,
    missed,
    netFundingUsd: positionStats.netFundingUsd
  };

  await repos.equity.insert(snapshot);
}
