/**
 * Builds /strategyName-style payload blocks from DB state + latest prices.
 */
import { AccountSnapshotRecord } from "../../db/repos/equityRepository.js";
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { formatEntryAge } from "../../utils/time.js";

export interface StrategyStatusPosition {
  tickerDeepLinkTemplate: string;
  symbol: string;
  bybitEntryPrice: number;
  bybitCurrentPrice: number;
  entryPrice: number;
  pnlPct: number;
  pnlUsd: number;
  age: string;
  currentPrice: number;
  takeProfitPrice: number;
  liquidationPrice: number;
}

export interface StrategyStatusLive {
  pnlPct: number;
  pnlUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  entries: number;
  openTrades: number;
  missed: number;
  winners: number;
  losers: number;
  winPct: number;
  replaced: number;
  liquidations: number;
  equityUsd: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  netFundingUsd: number;
}

export interface StrategyStatusPayload {
  positions: StrategyStatusPosition[];
  live: StrategyStatusLive;
}

const DEFAULT_STARTING_EQUITY_USD = 10_000;

function liquidationPrice(side: "LONG" | "SHORT", entryPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;

  if (side === "SHORT") return entryPrice * (1 + 1 / leverage);
  return entryPrice * (1 - 1 / leverage);
}

function positionPnlUsd(position: OpenPositionRecord, currentPrice: number): number {
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;

  const move = position.side === "SHORT"
    ? (position.entryPrice - currentPrice) / position.entryPrice
    : (currentPrice - position.entryPrice) / position.entryPrice;

  if (Number.isFinite(position.notionalUsd) && position.notionalUsd > 0) {
    return position.notionalUsd * move;
  }

  return position.marginUsd * position.leverage * move;
}

function positionPnlPct(position: OpenPositionRecord, pnlUsd: number): number {
  if (!Number.isFinite(position.marginUsd) || position.marginUsd <= 0) return 0;
  return (pnlUsd / position.marginUsd) * 100;
}

function toWinPct(winners: number, losers: number): number {
  const closed = winners + losers;
  if (closed <= 0) return 0;
  return (winners / closed) * 100;
}

function sortByEntryTime(rows: OpenPositionRecord[]): OpenPositionRecord[] {
  return [...rows].sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
}

function toPositions(
  openPositions: OpenPositionRecord[],
  priceBySymbol: Map<string, number>,
  bybitPriceBySymbol: Map<string, number> | undefined,
  tickerDeepLinkTemplate: string,
  nowMs: number
): StrategyStatusPosition[] {
  return sortByEntryTime(openPositions).map((position) => {
    const currentPrice = priceBySymbol.get(position.symbol) ?? position.entryPrice;
    const pnlUsd = positionPnlUsd(position, currentPrice);
    const bybitEntryPrice = position.entryPrice;
    const bybitCurrentPrice = bybitPriceBySymbol?.get(position.symbol) ?? bybitEntryPrice;

    return {
      tickerDeepLinkTemplate,
      symbol: position.symbol,
      bybitEntryPrice,
      bybitCurrentPrice,
      entryPrice: position.entryPrice,
      pnlPct: positionPnlPct(position, pnlUsd),
      pnlUsd,
      age: formatEntryAge(Date.parse(position.entryTime), nowMs),
      currentPrice,
      takeProfitPrice: position.takeProfitPrice ?? 0,
      liquidationPrice: liquidationPrice(position.side, position.entryPrice, position.leverage)
    };
  });
}

function unrealizedPnlUsd(openPositions: OpenPositionRecord[], priceBySymbol: Map<string, number>): number {
  return openPositions
    .map((position) => {
      const currentPrice = priceBySymbol.get(position.symbol) ?? position.entryPrice;
      return positionPnlUsd(position, currentPrice);
    })
    .reduce((sum, value) => sum + value, 0);
}

function openNetFundingUsd(openPositions: OpenPositionRecord[]): number {
  return openPositions.reduce((sum, position) => sum + (position.netFundingUsd ?? 0), 0);
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

export function buildStatusPayload(input: {
  openPositions: OpenPositionRecord[];
  latestSnapshot: AccountSnapshotRecord | null;
  priceBySymbol: Map<string, number>;
  bybitPriceBySymbol?: Map<string, number>;
  tickerDeepLinkTemplate: string;
  liveExchangeAccount?: ExchangeAccountState | null;
  nowMs?: number;
  startingEquityUsd?: number;
}): StrategyStatusPayload {
  const nowMs = input.nowMs ?? Date.now();
  const liveExchange = input.liveExchangeAccount ?? null;
  const exchangeEquity = finiteOrUndefined(liveExchange?.equityUsd);
  const startingEquityUsd = Number.isFinite(input.startingEquityUsd)
    ? Number(input.startingEquityUsd)
    : exchangeEquity ?? DEFAULT_STARTING_EQUITY_USD;

  const positions = toPositions(
    input.openPositions,
    input.priceBySymbol,
    input.bybitPriceBySymbol,
    input.tickerDeepLinkTemplate,
    nowMs
  );

  const unrealizedDerived = unrealizedPnlUsd(input.openPositions, input.priceBySymbol);
  const marginDerived = input.openPositions.reduce((sum, p) => sum + p.marginUsd, 0);
  const notionalDerived = input.openPositions.reduce((sum, p) => sum + p.notionalUsd, 0);

  const realizedPnlUsd = input.latestSnapshot?.realizedPnlUsd ?? 0;
  const netFundingUsd = input.latestSnapshot?.netFundingUsd ?? openNetFundingUsd(input.openPositions);

  const equityBaseDerived = input.latestSnapshot
    ? input.latestSnapshot.equityUsd - input.latestSnapshot.unrealizedPnlUsd
    : startingEquityUsd + realizedPnlUsd + netFundingUsd;

  const marginInUseUsd = finiteOrUndefined(liveExchange?.marginInUseUsd) ?? marginDerived;
  const openNotionalUsd = finiteOrUndefined(liveExchange?.openNotionalUsd) ?? notionalDerived;
  const unrealized = finiteOrUndefined(liveExchange?.unrealizedPnlUsd) ?? unrealizedDerived;

  const exchangeCash = finiteOrUndefined(liveExchange?.cashUsd);

  const equityUsd =
    exchangeEquity ??
    (exchangeCash !== undefined ? exchangeCash + marginInUseUsd : equityBaseDerived + unrealized);

  const cashUsd =
    exchangeCash ??
    (exchangeEquity !== undefined ? exchangeEquity - marginInUseUsd : equityUsd - marginInUseUsd);

  const pnlUsd = exchangeEquity !== undefined
    ? exchangeEquity - startingEquityUsd
    : realizedPnlUsd + unrealized + netFundingUsd;

  const winners = input.latestSnapshot?.winners ?? 0;
  const losers = input.latestSnapshot?.losers ?? 0;

  return {
    positions,
    live: {
      pnlPct: (pnlUsd / startingEquityUsd) * 100,
      pnlUsd,
      unrealizedPnlUsd: unrealized,
      unrealizedPnlPct: (unrealized / startingEquityUsd) * 100,
      entries: input.latestSnapshot?.entries ?? 0,
      openTrades: input.openPositions.length,
      missed: input.latestSnapshot?.missed ?? 0,
      winners,
      losers,
      winPct: toWinPct(winners, losers),
      replaced: input.latestSnapshot?.replaced ?? 0,
      liquidations: input.latestSnapshot?.liquidations ?? 0,
      equityUsd,
      cashUsd,
      marginInUseUsd,
      openNotionalUsd,
      netFundingUsd
    }
  };
}
