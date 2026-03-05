/**
 * XSP V19 Telegram message formatter.
 * Spacing intentionally mirrors strategies/xsp_v19/telegram.md.
 */
export const STRATEGY_LABEL = "XSP V19";
export const STRATEGY_LEVERAGE = 5;
export const STRATEGY_EMOJI = "🐦‍🔥";
export const ENTRY_TRACK_DEFAULTS = {
  takeProfitUnlevered: 0.04,
  entryFeeBps: 6,
  entrySlippageBps: 0
};

const TITLE_WIDTH = "🐦‍🔥 StrategyName V#".length + 48;
const NBSP = "\u00A0";

function buildTickerLink(template, symbol) {
  const url = template.replaceAll("{symbol}", encodeURIComponent(symbol));
  return `<a href="${url}"><b>${symbol}</b></a>`;
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return "$0.0000";
  return `$${value.toFixed(4)}`;
}

function fmtUsdOrNa(value) {
  if (!Number.isFinite(value)) return "N/A";
  return fmtUsd(value);
}

function fmtUsd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function fmtRoundedUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${Math.ceil(value)}`;
}

function fmtSignedUsd(value, showPositiveSign = true) {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value < 0 ? "-" : showPositiveSign && value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return "0.00%";
  return `${value.toFixed(2)}%`;
}

function fmtBps(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${value.toFixed(2)} bps`;
}

function fmtAge(value) {
  if (typeof value !== "string" || value.length === 0) return "00 - 00:00";
  return value.replace("-", " - ");
}

function fmtMillions(value) {
  if (!Number.isFinite(value)) return "N/A";
  return `${(value / 1_000_000).toFixed(2)} M`;
}

function padTitle(raw) {
  if (raw.length >= TITLE_WIDTH) return raw;
  return `${raw}${NBSP.repeat(TITLE_WIDTH - raw.length)}`;
}

function titleLine(input) {
  return `<b>${padTitle(`${input.emoji} ${input.strategyLabel}`)}</b>`;
}

function toAccountLines(account) {
  return [
    "<b>Account Update:</b>",
    `Eq: ${fmtUsd(account.equityUsd)} | Cash: ${fmtUsd(account.cashUsd)}`,
    `M: ${fmtUsd(account.marginInUseUsd)} | N: ${fmtUsd(account.openNotionalUsd)}`,
    "",
    `Net Funding: ${fmtSignedUsd(Number(account?.netFundingUsd ?? 0))}`
  ];
}

function metricSR(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "N/A";
}

function metricOpened(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.max(0, Math.floor(n))) : "N/A";
}

function conditionLines(srNow, volNow, openedNow) {
  return [
    `    SR:${NBSP.repeat(11)}${metricSR(srNow)}`,
    `    Vol:${NBSP.repeat(10)}${fmtMillions(volNow)}`,
    `    Opened: ${metricOpened(openedNow)}`
  ];
}

function tickerAgeLine(ticker, age) {
  return `${ticker}${NBSP.repeat(14)}${fmtAge(age)}`;
}

export function buildEntryAvailableTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "🟢 Entry Available:",
    "",
    `${ticker}`,
    `    Bybit:  E: ${fmtPrice(input.bybitPriceAtAlert)}`,
    `    Mexc:  E: ${fmtPrice(input.mexcPriceAtAlert)}`,
    "",
    `    Margin: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    `    TP: ${fmtPrice(input.takeProfitEstimatePrice)}`,
    "",
    ...conditionLines(input.sellRatioNow, Number(input.hourVolumeNow), input.currentOpenTrades)
  ].join("\n");
}

export function buildReplacementAvailableTelegramMessage(input) {
  const closeTicker = buildTickerLink(input.tickerDeepLinkTemplate, input.loserSymbol);
  const openTicker = buildTickerLink(input.tickerDeepLinkTemplate, input.newSymbol);

  return [
    titleLine(input),
    "🚨 Replacement:",
    "",
    "Close:",
    tickerAgeLine(closeTicker, input.loserAge),
    `    Bybit: E: ${fmtPrice(input.loserBybitEntryPrice)} | C: ${fmtPrice(input.loserBybitCurrentPrice)}`,
    "",
    `    E: ${fmtPrice(input.loserEntryPrice)} | PNL: ${fmtPct(input.loserPnlPct)} / ${fmtSignedUsd(input.loserPnlUsd)}`,
    `    C: ${fmtPrice(input.loserCurrentPrice)} | TP: ${fmtPrice(input.loserTakeProfitPrice)} | L: ${fmtPrice(input.loserLiquidationPrice)}`,
    "",
    "Open:",
    `${openTicker}`,
    `    Bybit:  E: ${fmtPrice(input.newBybitPriceAtAlert)}`,
    `    Mexc:  E: ${fmtPrice(input.newMexcPriceAtAlert)}`,
    "",
    `    Margin: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    "",
    ...conditionLines(input.newSellRatioNow, Number(input.newHourVolumeNow), input.currentOpenTrades)
  ].join("\n");
}

export function buildTrackDecisionTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "🧭 External Position Detected:",
    "",
    `${ticker}`,
    `    E: ${fmtPrice(input.entryPrice)} | TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`,
    "",
    ...conditionLines(input.sellRatioNow, Number(input.hourVolumeNow), input.currentOpenTrades)
  ].join("\n");
}

export function buildExitAvailableTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);
  const icon = input.pnlPct >= 0 ? "✅" : "❌";

  return [
    titleLine(input),
    `${icon}EXIT ALERT: ${input.reason}`,
    "",
    tickerAgeLine(ticker, input.age),
    `    Bybit: E: ${fmtPrice(input.bybitEntryPrice)} | C: ${fmtPrice(input.bybitCurrentPrice)}`,
    "",
    `    E: ${fmtPrice(input.entryPrice)} | PNL: ${fmtPct(input.pnlPct)} | PNL: ${fmtSignedUsd(input.pnlUsd)}`,
    `    C: ${fmtPrice(input.currentPrice)} | TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`
  ].join("\n");
}

export function buildEntryConfirmedTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "🍀 Opened Trade:",
    "",
    `${ticker}`,
    `    E: ${fmtPrice(input.entryPrice)} | RE: ${fmtPrice(input.realizedEntryPrice)}`,
    `    TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`,
    "",
    `    Entry Slippage: ${fmtBps(input.entrySlippageBps)}`,
    "",
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildExitConfirmedTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);
  const icon = input.pnlUsd >= 0 ? "✅" : "❌";

  return [
    titleLine(input),
    `${icon}CLOSED: ${input.reason}`,
    "",
    `${ticker}`,
    `Time: ${fmtAge(input.age)}`,
    `Entry: ${fmtUsdOrNa(input.entryUsd)}`,
    `Exit:  ${fmtUsdOrNa(input.exitUsd)}`,
    "",
    `PNL: ${fmtSignedUsd(input.pnlUsd)} | ${fmtPct(input.pnlPct)}`,
    "",
    `Exit: ${fmtBps(input.exitSlippageBps)} | RT: ${fmtBps(input.roundtripSlippageBps)}`,
    `Funding: ${fmtSignedUsd(input.fundingUsd ?? 0)}`,
    "",
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildWaitingForConfirmationMessage(input) {
  const symbolList = Array.isArray(input.symbols) ? input.symbols : [input.symbol];
  const symbols = symbolList.filter((value) => typeof value === "string" && value.length > 0);
  const tickerLines = symbols.map((symbol, index) => `${index + 1}. ${buildTickerLink(input.tickerDeepLinkTemplate, symbol)}`);

  return [
    titleLine(input),
    "⏳ Waiting for trade confirmation:",
    "",
    ...tickerLines
  ].join("\n");
}

export function buildFundingTelegramMessage(input) {
  const lines = [];
  for (let i = 0; i < input.updates.length; i += 1) {
    const item = input.updates[i];
    const ticker = buildTickerLink(input.tickerDeepLinkTemplate, item.symbol);
    lines.push(`${i + 1}. ${ticker} | ${fmtSignedUsd(item.fundingUsd)} | Net: ${fmtSignedUsd(item.netFundingUsd)}`);
    if (i < input.updates.length - 1) {
      lines.push("");
    }
  }

  return [
    titleLine(input),
    "💸 Fudnding Update:",
    "",
    ...lines,
    "",
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildInfoCommandMessage(input) {
  return [
    titleLine(input),
    "",
    `Leverage: ${input.leverage}x`,
    "Margin: min($500, cash * 1%)",
    "",
    "Entry:",
    "    Sell Ratio &lt;= 0.2",
    "    Volume >= 1,000,000",
    "    Live trades &lt; 15",
    "",
    "Exit:",
    "    Take Profit: +20% leveraged",
    "    ΔSR: 0.1",
    "    Replacement Threshold: -5%"
  ].join("\n");
}

function buildOpenPositionBlock(index, item) {
  const ticker = buildTickerLink(item.tickerDeepLinkTemplate, item.symbol);

  return [
    `${index}. ${ticker}${NBSP.repeat(14)}${fmtAge(item.age)}`,
    `      Bybit: E: ${fmtPrice(item.bybitEntryPrice)} | C: ${fmtPrice(item.bybitCurrentPrice)}`,
    "",
    `      E: ${fmtPrice(item.entryPrice)} | PNL: ${fmtPct(item.pnlPct)} | PNL: ${fmtSignedUsd(item.pnlUsd, false)}`,
    `      C: ${fmtPrice(item.currentPrice)} | TP: ${fmtPrice(item.takeProfitPrice)} | L: ${fmtPrice(item.liquidationPrice)}`
  ];
}

function buildOpenPositionLines(input) {
  if (input.positions.length === 0) {
    return ["No open positions."];
  }

  const lines = [];
  for (let i = 0; i < input.positions.length; i += 1) {
    lines.push(...buildOpenPositionBlock(i + 1, input.positions[i]));
    if (i < input.positions.length - 1) {
      lines.push("");
    }
  }
  return lines;
}

export function buildStrategyStatusTelegramMessage(input) {
  const positionLines = buildOpenPositionLines(input);

  return [
    titleLine(input),
    "📈 Open Positions",
    "",
    ...positionLines,
    "",
    "",
    "<b>Live Stats:</b>",
    "",
    `PNL:   ${fmtPct(input.live.pnlPct)} | ${fmtSignedUsd(input.live.pnlUsd, false)}`,
    `U-PNL: ${fmtPct(input.live.unrealizedPnlPct)} | ${fmtSignedUsd(input.live.unrealizedPnlUsd, false)}`,
    "",
    `Entries: ${input.live.entries} | O: ${input.live.openTrades} | M: ${input.live.missed}`,
    `Winners: ${input.live.winners} | Losers: ${input.live.losers}  |  ${fmtPct(input.live.winPct)}`,
    `Replaced: ${input.live.replaced} | Liq'd: ${input.live.liquidations}`,
    "",
    `Eq: ${fmtUsd(input.live.equityUsd)} | Cash: ${fmtUsd(input.live.cashUsd)}`,
    `M: ${fmtUsd(input.live.marginInUseUsd)} | N: ${fmtUsd(input.live.openNotionalUsd)}`,
    "",
    `Net Funding: ${fmtSignedUsd(input.live.netFundingUsd)}`
  ].join("\n");
}

export function buildNoSignalTelegramMessage(input) {
  return `${titleLine(input)}\n📈 Open Positions\n\nNo new entry signals this cycle.`;
}
