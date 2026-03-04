/**
 * XSP V19 strategy logic (manual execution mode).
 *
 * Signal source: Bybit
 * Execution/account source: MEXC
 */
import {
  STRATEGY_EMOJI,
  STRATEGY_LABEL,
  buildEntryAvailableTelegramMessage,
  buildExitAvailableTelegramMessage,
  buildNoSignalTelegramMessage,
  buildReplacementAvailableTelegramMessage
} from "./telegram.js";
import { extractBybitSignalRows, mexcToBybitSymbol } from "./market.js";

const LEVERAGE = 5;
const CONCURRENT_TRADE_CAP = 15;
const SELL_RATIO_MAX = 0.2;
const SELL_RATIO_EXIT_DELTA = 0.1;
const MIN_HOUR_VOLUME = 1_000_000;
const TAKE_PROFIT_UNLEVERED = 0.04;
const REPLACEMENT_THRESHOLD_PCT = -5;
const MAX_MARGIN_USD = 500;
const MARGIN_CASH_PCT = 0.01;

const ENTRY_FEE_BPS = 6;
const EXIT_FEE_BPS = 6;
const ENTRY_SLIPPAGE_BPS = 6;
const EXIT_SLIPPAGE_BPS = 6;

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveCashUsd(input) {
  const exchangeCash = parseNumber(input.exchangeAccount?.cashUsd);
  if (exchangeCash !== null && exchangeCash >= 0) return exchangeCash;

  const previousCash = parseNumber(input.previousAccountSnapshot?.cashUsd);
  if (previousCash !== null && previousCash >= 0) return previousCash;

  return 0;
}

function resolveMarginToPut(input) {
  const cashUsd = resolveCashUsd(input);
  if (!Number.isFinite(cashUsd) || cashUsd <= 0) return 0;

  const raw = Math.min(MAX_MARGIN_USD, cashUsd * MARGIN_CASH_PCT);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.ceil(raw);
}

function shortLiquidationPrice(entryPrice, leverage) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return entryPrice * (1 + 1 / leverage);
}

function computeShortPnlPct(position, currentPrice) {
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  const unlevered = (position.entryPrice - currentPrice) / position.entryPrice;
  return unlevered * position.leverage * 100;
}

function computeShortPnlUsd(position, currentPrice) {
  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;

  const move = (position.entryPrice - currentPrice) / position.entryPrice;
  const notional = Number(position.notionalUsd ?? 0);
  if (Number.isFinite(notional) && notional > 0) {
    return notional * move;
  }

  const margin = Number(position.marginUsd ?? 0);
  const leverage = Number(position.leverage ?? LEVERAGE);
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return margin * leverage * move;
}

function formatAge(entryTimeIso, nowIso) {
  const startMs = Date.parse(entryTimeIso);
  const endMs = Date.parse(nowIso);
  const diffMs = Math.max(0, endMs - startMs);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return `${String(days).padStart(2, "0")}-${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toSimOpenPositions(input) {
  return input.openPositions.map((position) => ({
    ...position,
    qty: Number(position.qty ?? 0),
    leverage: Number(position.leverage ?? LEVERAGE),
    marginUsd: Number(position.marginUsd ?? 0),
    notionalUsd: Number(position.notionalUsd ?? 0),
    entrySlippageBps: Number.isFinite(Number(position.entrySlippageBps)) ? Number(position.entrySlippageBps) : null,
    bybitSymbol: mexcToBybitSymbol(position.symbol),
    bybitEntryPrice: Number(position.entryPrice)
  }));
}

function shouldTakeProfit(position, mexcPrice) {
  if (!Number.isFinite(mexcPrice) || mexcPrice <= 0) return false;
  if (position.side !== "SHORT") return false;
  if (position.takeProfitPrice === null) return false;
  return mexcPrice <= position.takeProfitPrice;
}

function shouldSellRatioDeltaExit(position, bybitSellRatio) {
  if (!Number.isFinite(bybitSellRatio)) return false;
  if (position.side !== "SHORT") return false;
  if (position.entrySellRatio === null) return false;
  return bybitSellRatio - position.entrySellRatio >= SELL_RATIO_EXIT_DELTA;
}

function shouldLiquidation(position, mexcPrice) {
  if (!Number.isFinite(mexcPrice) || mexcPrice <= 0) return false;
  if (position.side !== "SHORT") return false;
  const liq = shortLiquidationPrice(position.entryPrice, position.leverage);
  return mexcPrice >= liq;
}

function mapExitReason(position, market) {
  if (!market) return null;

  if (shouldLiquidation(position, market.mexcPrice)) {
    return {
      code: "LIQUIDATION",
      label: "Liquidation",
      expectedEventType: "LIQUIDATION"
    };
  }

  if (shouldTakeProfit(position, market.mexcPrice)) {
    return {
      code: "TP",
      label: "Take Profit",
      expectedEventType: "EXIT"
    };
  }

  if (shouldSellRatioDeltaExit(position, market.sellRatio)) {
    return {
      code: "SELL_RATIO_DELTA",
      label: "Sell Ratio Delta",
      expectedEventType: "EXIT"
    };
  }

  return null;
}

function createExitAvailableMessage(input, position, market, reason) {
  const currentPrice = Number.isFinite(market?.mexcPrice) ? market.mexcPrice : position.entryPrice;
  const bybitCurrentPrice = Number.isFinite(market?.bybitPrice) ? market.bybitPrice : position.bybitEntryPrice;
  const pnlPct = computeShortPnlPct(position, currentPrice);
  const pnlUsd = computeShortPnlUsd(position, currentPrice);
  const age = formatAge(position.entryTime, input.nowIso);
  const liquidationPrice = shortLiquidationPrice(position.entryPrice, position.leverage);

  const payload = {
    symbol: position.symbol,
    bybitSymbol: market?.bybitSymbol ?? position.bybitSymbol,
    bybitEntryPrice: position.bybitEntryPrice,
    bybitCurrentPrice,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    expectedEventType: reason.expectedEventType,
    entryPrice: position.entryPrice,
    currentPrice,
    pnlPct,
    pnlUsd,
    age,
    takeProfitPrice: position.takeProfitPrice ?? 0,
    liquidationPrice,
    entryTime: position.entryTime,
    leverage: position.leverage,
    marginUsd: position.marginUsd,
    notionalUsd: position.notionalUsd,
    qty: position.qty,
    side: position.side,
    takeProfitUnlevered: TAKE_PROFIT_UNLEVERED,
    entryFeeBps: ENTRY_FEE_BPS,
    exitFeeBps: EXIT_FEE_BPS,
    entrySlippageBps: position.entrySlippageBps,
    exitSlippageBps: EXIT_SLIPPAGE_BPS
  };

  return {
    type: "EXIT",
    symbol: position.symbol,
    sendTelegram: true,
    text: buildExitAvailableTelegramMessage({
      emoji: STRATEGY_EMOJI,
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      symbol: position.symbol,
      bybitEntryPrice: position.bybitEntryPrice,
      bybitCurrentPrice,
      reason: reason.label,
      entryPrice: position.entryPrice,
      pnlPct,
      pnlUsd,
      age,
      currentPrice,
      takeProfitPrice: position.takeProfitPrice ?? 0,
      liquidationPrice
    }),
    manualAlert: {
      kind: "EXIT_AVAILABLE",
      primarySymbol: position.symbol,
      reason: reason.label,
      payload,
      buttons: ["CLOSED", "REFRESH"]
    }
  };
}

function findReplacementCandidate(openPositions, signalByMexcSymbol) {
  let bestIndex = -1;
  let bestPnlPct = Number.POSITIVE_INFINITY;

  for (let i = 0; i < openPositions.length; i += 1) {
    const position = openPositions[i];
    const market = signalByMexcSymbol.get(position.symbol);
    if (!market) continue;

    const pnlPct = computeShortPnlPct(position, market.mexcPrice);
    if (pnlPct > REPLACEMENT_THRESHOLD_PCT) continue;

    if (pnlPct < bestPnlPct) {
      bestPnlPct = pnlPct;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function selectSignals(rows, openSymbols) {
  return rows
    .filter((row) => row.sellRatio <= SELL_RATIO_MAX && row.hourVolume >= MIN_HOUR_VOLUME)
    .filter((row) => !openSymbols.has(row.mexcSymbol))
    .sort((a, b) => a.sellRatio - b.sellRatio);
}

function createEntryAvailableMessage(input, signal, currentOpenTrades) {
  const marginToPut = resolveMarginToPut(input);
  const payload = {
    symbol: signal.mexcSymbol,
    bybitSymbol: signal.bybitSymbol,
    bybitPriceAtAlert: signal.bybitPrice,
    priceAtAlert: signal.mexcPrice,
    marginToPut,
    sellRatioNow: signal.sellRatio,
    hourVolumeNow: signal.hourVolume,
    sellRatioMax: SELL_RATIO_MAX,
    minHourVolume: MIN_HOUR_VOLUME,
    concurrentCap: CONCURRENT_TRADE_CAP,
    currentOpenTrades,
    leverage: LEVERAGE,
    takeProfitUnlevered: TAKE_PROFIT_UNLEVERED,
    entryFeeBps: ENTRY_FEE_BPS,
    exitFeeBps: EXIT_FEE_BPS,
    entrySlippageBps: ENTRY_SLIPPAGE_BPS,
    exitSlippageBps: EXIT_SLIPPAGE_BPS,
    entrySellRatio: signal.sellRatio
  };

  return {
    type: "ENTRY",
    symbol: signal.mexcSymbol,
    sendTelegram: true,
    text: buildEntryAvailableTelegramMessage({
      emoji: STRATEGY_EMOJI,
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      symbol: signal.mexcSymbol,
      bybitPriceAtAlert: signal.bybitPrice,
      mexcPriceAtAlert: signal.mexcPrice,
      marginToPut,
      sellRatioNow: signal.sellRatio,
      hourVolumeNow: signal.hourVolume,
      currentOpenTrades
    }),
    manualAlert: {
      kind: "ENTRY_AVAILABLE",
      primarySymbol: signal.mexcSymbol,
      payload,
      buttons: ["OPENED", "REFRESH"]
    }
  };
}

function createReplacementMessage(input, signal, loser, signalByMexcSymbol, currentOpenTrades) {
  const marginToPut = resolveMarginToPut(input);
  const loserMarket = signalByMexcSymbol.get(loser.symbol);
  const loserCurrentPrice = loserMarket ? loserMarket.mexcPrice : loser.entryPrice;
  const loserBybitCurrent = loserMarket ? loserMarket.bybitPrice : loser.bybitEntryPrice;
  const loserPnlPct = computeShortPnlPct(loser, loserCurrentPrice);
  const loserPnlUsd = computeShortPnlUsd(loser, loserCurrentPrice);
  const loserAge = formatAge(loser.entryTime, input.nowIso);
  const loserLiq = shortLiquidationPrice(loser.entryPrice, loser.leverage);

  const payload = {
    loserSymbol: loser.symbol,
    loserBybitSymbol: loserMarket?.bybitSymbol ?? loser.bybitSymbol,
    loserBybitEntryPrice: loser.bybitEntryPrice,
    loserBybitCurrentPrice: loserBybitCurrent,
    loserReasonLabel: "Replacement",
    loserEntryPrice: loser.entryPrice,
    loserCurrentPrice,
    loserPnlPct,
    loserPnlUsd,
    loserAge,
    loserTakeProfitPrice: loser.takeProfitPrice ?? 0,
    loserLiquidationPrice: loserLiq,
    loserEntryTime: loser.entryTime,
    loserLeverage: loser.leverage,
    loserMarginUsd: loser.marginUsd,
    loserNotionalUsd: loser.notionalUsd,
    loserQty: loser.qty,
    loserEntrySlippageBps: loser.entrySlippageBps,
    newSymbol: signal.mexcSymbol,
    newBybitSymbol: signal.bybitSymbol,
    newBybitPriceAtAlert: signal.bybitPrice,
    newPriceAtAlert: signal.mexcPrice,
    marginToPut,
    newSellRatioNow: signal.sellRatio,
    newHourVolumeNow: signal.hourVolume,
    sellRatioMax: SELL_RATIO_MAX,
    minHourVolume: MIN_HOUR_VOLUME,
    leverage: LEVERAGE,
    takeProfitUnlevered: TAKE_PROFIT_UNLEVERED,
    entryFeeBps: ENTRY_FEE_BPS,
    exitFeeBps: EXIT_FEE_BPS,
    entrySlippageBps: ENTRY_SLIPPAGE_BPS,
    exitSlippageBps: EXIT_SLIPPAGE_BPS,
    entrySellRatio: signal.sellRatio
  };

  return {
    type: "ENTRY",
    symbol: signal.mexcSymbol,
    sendTelegram: true,
    text: buildReplacementAvailableTelegramMessage({
      emoji: STRATEGY_EMOJI,
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      loserSymbol: loser.symbol,
      loserBybitEntryPrice: loser.bybitEntryPrice,
      loserBybitCurrentPrice: loserBybitCurrent,
      loserEntryPrice: loser.entryPrice,
      loserPnlPct,
      loserPnlUsd,
      loserAge,
      loserCurrentPrice,
      loserTakeProfitPrice: loser.takeProfitPrice ?? 0,
      loserLiquidationPrice: loserLiq,
      newSymbol: signal.mexcSymbol,
      newBybitPriceAtAlert: signal.bybitPrice,
      newMexcPriceAtAlert: signal.mexcPrice,
      marginToPut,
      newSellRatioNow: signal.sellRatio,
      newHourVolumeNow: signal.hourVolume,
      currentOpenTrades,
      replacementThresholdPct: REPLACEMENT_THRESHOLD_PCT
    }),
    manualAlert: {
      kind: "REPLACEMENT_AVAILABLE",
      primarySymbol: signal.mexcSymbol,
      secondarySymbol: loser.symbol,
      reason: "Replacement",
      payload,
      buttons: ["OPENED", "REFRESH"]
    }
  };
}

function appendNoSignalMessage(messages, input) {
  if (messages.length > 0) return;

  messages.push({
    type: "STATUS",
    sendTelegram: false,
    text: buildNoSignalTelegramMessage({
      emoji: STRATEGY_EMOJI,
      strategyLabel: STRATEGY_LABEL
    })
  });
}

function uniqueMexcSymbols(rows) {
  const set = new Set(rows.map((row) => row.mexcSymbol));
  return [...set];
}

function assertBybitSignalAvailability(summary) {
  if (summary.bybitTickerCount <= 0) {
    throw new Error("Bybit signal unavailable: no ticker rows returned");
  }

  if (summary.bybitSellRatioCount <= 0) {
    throw new Error("Bybit signal unavailable: no account-ratio rows returned");
  }

  if (summary.rows.length <= 0) {
    throw new Error(
      `Bybit signal unavailable: unable to merge ticker (${summary.bybitTickerCount}) with account-ratio (${summary.bybitSellRatioCount})`
    );
  }
}

export async function entry(input) {
  const summary = extractBybitSignalRows(input.snapshot);
  assertBybitSignalAvailability(summary);

  const rows = summary.rows;
  const signalByMexcSymbol = new Map(rows.map((row) => [row.mexcSymbol, row]));
  const openPositions = toSimOpenPositions(input);

  const messages = [];

  for (const position of openPositions) {
    const market = signalByMexcSymbol.get(position.symbol);
    const reason = mapExitReason(position, market);
    if (!reason) continue;

    messages.push(createExitAvailableMessage(input, position, market, reason));
  }

  const openSymbols = new Set(openPositions.map((position) => position.symbol));
  const signals = selectSignals(rows, openSymbols);

  for (const signal of signals) {
    if (openPositions.length >= CONCURRENT_TRADE_CAP) {
      const replaceIndex = findReplacementCandidate(openPositions, signalByMexcSymbol);
      if (replaceIndex < 0) {
        continue;
      }

      const loser = openPositions[replaceIndex];
      messages.push(createReplacementMessage(input, signal, loser, signalByMexcSymbol, openPositions.length));
      continue;
    }

    messages.push(createEntryAvailableMessage(input, signal, openPositions.length));
  }

  appendNoSignalMessage(messages, input);

  return {
    strategyName: input.strategyName,
    messages,
    positionEvents: [],
    accountSnapshot: null,
    trackedSymbols: uniqueMexcSymbols(rows)
  };
}
