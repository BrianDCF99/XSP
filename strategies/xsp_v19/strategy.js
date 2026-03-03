/**
 * XSP V19 strategy logic (manual execution mode).
 *
 * Responsibilities:
 * - Parse market snapshot rows
 * - Emit Entry/Exit/Replacement AVAILABLE alerts only
 * - Attach structured manual-alert payloads for button handling
 */
import {
  STRATEGY_EMOJI,
  STRATEGY_LABEL,
  buildEntryAvailableTelegramMessage,
  buildExitAvailableTelegramMessage,
  buildNoSignalTelegramMessage,
  buildReplacementAvailableTelegramMessage
} from "./telegram.js";

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

function toRowArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.result)) return obj.result;
  if (obj.data && typeof obj.data === "object" && Array.isArray(obj.data.list)) return obj.data.list;
  if (obj.result && typeof obj.result === "object" && Array.isArray(obj.result.list)) return obj.result.list;
  return [];
}

function extractTickerRows(snapshot) {
  const tickerLike = snapshot.endpoints.filter((endpoint) => endpoint.name.toLowerCase().includes("ticker"));
  const rows = [];

  for (const endpoint of tickerLike) {
    rows.push(...toRowArray(endpoint.payload));
  }

  return rows;
}

function normalizeTickerRow(row) {
  if (!row || typeof row !== "object") return null;

  const symbol = row.symbol || row.contract || row.symbolName || row.displayName || row.s;
  const sellRatio = parseNumber(row.sellRatio ?? row.sell_ratio ?? row.shortRatio ?? row.short_ratio ?? row.accountSellRatio);
  const hourVolume = parseNumber(
    row.hourVolume ??
      row.volumeUsd ??
      row.volume ??
      row.vol ??
      row.turnover24h ??
      row.quoteVolume ??
      row.amount24
  );
  const lastPrice = parseNumber(row.lastPrice ?? row.price ?? row.last_price ?? row.markPrice ?? row.indexPrice ?? row.close);
  const openInterest = parseNumber(row.openInterest ?? row.open_interest ?? row.holdVol);

  if (typeof symbol !== "string" || symbol.length === 0) return null;
  if (sellRatio === null || hourVolume === null || lastPrice === null) return null;

  return {
    symbol,
    sellRatio,
    hourVolume,
    lastPrice,
    openInterest
  };
}

function normalizeRows(snapshot) {
  return extractTickerRows(snapshot)
    .map(normalizeTickerRow)
    .filter((row) => row !== null);
}

function buildMarketBySymbol(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.symbol, row);
  }
  return map;
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
    entrySlippageBps: Number.isFinite(Number(position.entrySlippageBps)) ? Number(position.entrySlippageBps) : null
  }));
}

function shouldTakeProfit(position, marketRow) {
  if (!marketRow) return false;
  if (position.side !== "SHORT") return false;
  if (position.takeProfitPrice === null) return false;
  return marketRow.lastPrice <= position.takeProfitPrice;
}

function shouldSellRatioDeltaExit(position, marketRow) {
  if (!marketRow) return false;
  if (position.side !== "SHORT") return false;
  if (position.entrySellRatio === null) return false;
  return marketRow.sellRatio - position.entrySellRatio >= SELL_RATIO_EXIT_DELTA;
}

function shouldLiquidation(position, marketRow) {
  if (!marketRow) return false;
  if (position.side !== "SHORT") return false;
  const liq = shortLiquidationPrice(position.entryPrice, position.leverage);
  return marketRow.lastPrice >= liq;
}

function mapExitReason(position, marketRow) {
  if (shouldLiquidation(position, marketRow)) {
    return {
      code: "LIQUIDATION",
      label: "Liquidation",
      expectedEventType: "LIQUIDATION"
    };
  }

  if (shouldTakeProfit(position, marketRow)) {
    return {
      code: "TP",
      label: "Take Profit",
      expectedEventType: "EXIT"
    };
  }

  if (shouldSellRatioDeltaExit(position, marketRow)) {
    return {
      code: "SELL_RATIO_DELTA",
      label: "Sell Ratio Delta",
      expectedEventType: "EXIT"
    };
  }

  return null;
}

function createExitAvailableMessage(input, position, marketRow, reason) {
  const currentPrice = marketRow?.lastPrice ?? position.entryPrice;
  const pnlPct = computeShortPnlPct(position, currentPrice);
  const pnlUsd = computeShortPnlUsd(position, currentPrice);
  const age = formatAge(position.entryTime, input.nowIso);
  const liquidationPrice = shortLiquidationPrice(position.entryPrice, position.leverage);

  const payload = {
    symbol: position.symbol,
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
      exchange: input.exchange.toUpperCase(),
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      symbol: position.symbol,
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

function findReplacementCandidate(openPositions, marketBySymbol) {
  let bestIndex = -1;
  let bestPnlPct = Number.POSITIVE_INFINITY;

  for (let i = 0; i < openPositions.length; i += 1) {
    const position = openPositions[i];
    const market = marketBySymbol.get(position.symbol);
    if (!market) continue;

    const pnlPct = computeShortPnlPct(position, market.lastPrice);
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
    .filter((row) => !openSymbols.has(row.symbol))
    .sort((a, b) => a.sellRatio - b.sellRatio);
}

function createEntryAvailableMessage(input, signal, currentOpenTrades) {
  const marginToPut = resolveMarginToPut(input);
  const payload = {
    symbol: signal.symbol,
    priceAtAlert: signal.lastPrice,
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
    symbol: signal.symbol,
    sendTelegram: true,
    text: buildEntryAvailableTelegramMessage({
      emoji: STRATEGY_EMOJI,
      exchange: input.exchange.toUpperCase(),
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      symbol: signal.symbol,
      priceAtAlert: signal.lastPrice,
      marginToPut,
      sellRatioMax: SELL_RATIO_MAX,
      minHourVolume: MIN_HOUR_VOLUME,
      concurrentCap: CONCURRENT_TRADE_CAP,
      currentOpenTrades,
      sellRatioNow: signal.sellRatio,
      hourVolumeNow: signal.hourVolume
    }),
    manualAlert: {
      kind: "ENTRY_AVAILABLE",
      primarySymbol: signal.symbol,
      payload,
      buttons: ["OPENED", "REFRESH"]
    }
  };
}

function createReplacementMessage(input, signal, loser, marketBySymbol) {
  const marginToPut = resolveMarginToPut(input);
  const loserMarket = marketBySymbol.get(loser.symbol);
  const loserCurrentPrice = loserMarket ? loserMarket.lastPrice : loser.entryPrice;
  const loserPnlPct = computeShortPnlPct(loser, loserCurrentPrice);
  const loserPnlUsd = computeShortPnlUsd(loser, loserCurrentPrice);
  const loserAge = formatAge(loser.entryTime, input.nowIso);
  const loserLiq = shortLiquidationPrice(loser.entryPrice, loser.leverage);

  const payload = {
    loserSymbol: loser.symbol,
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
    newSymbol: signal.symbol,
    newPriceAtAlert: signal.lastPrice,
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
    symbol: signal.symbol,
    sendTelegram: true,
    text: buildReplacementAvailableTelegramMessage({
      emoji: STRATEGY_EMOJI,
      exchange: input.exchange.toUpperCase(),
      strategyLabel: STRATEGY_LABEL,
      tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
      loserSymbol: loser.symbol,
      loserEntryPrice: loser.entryPrice,
      loserPnlPct,
      loserPnlUsd,
      loserAge,
      loserCurrentPrice,
      loserTakeProfitPrice: loser.takeProfitPrice ?? 0,
      loserLiquidationPrice: loserLiq,
      newSymbol: signal.symbol,
      newPriceAtAlert: signal.lastPrice,
      marginToPut,
      sellRatioMax: SELL_RATIO_MAX,
      minHourVolume: MIN_HOUR_VOLUME,
      newSellRatioNow: signal.sellRatio,
      newHourVolumeNow: signal.hourVolume,
      replacementThresholdPct: REPLACEMENT_THRESHOLD_PCT
    }),
    manualAlert: {
      kind: "REPLACEMENT_AVAILABLE",
      primarySymbol: signal.symbol,
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
      exchange: input.exchange.toUpperCase(),
      strategyLabel: STRATEGY_LABEL
    })
  });
}

function uniqueSymbols(rows) {
  const set = new Set(rows.map((row) => row.symbol));
  return [...set];
}

export async function entry(input) {
  const rows = normalizeRows(input.snapshot);
  const marketBySymbol = buildMarketBySymbol(rows);
  const openPositions = toSimOpenPositions(input);

  const messages = [];

  for (const position of openPositions) {
    const marketRow = marketBySymbol.get(position.symbol);
    const reason = mapExitReason(position, marketRow);
    if (!reason) continue;

    messages.push(createExitAvailableMessage(input, position, marketRow, reason));
  }

  const openSymbols = new Set(openPositions.map((position) => position.symbol));
  const signals = selectSignals(rows, openSymbols);

  for (const signal of signals) {
    if (openPositions.length >= CONCURRENT_TRADE_CAP) {
      const replaceIndex = findReplacementCandidate(openPositions, marketBySymbol);
      if (replaceIndex < 0) {
        continue;
      }

      const loser = openPositions[replaceIndex];
      messages.push(createReplacementMessage(input, signal, loser, marketBySymbol));
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
    trackedSymbols: uniqueSymbols(rows)
  };
}
