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

function buildTickerLink(template, symbol) {
  const url = template.replaceAll("{symbol}", encodeURIComponent(symbol));
  return `<a href=\"${url}\">${symbol}</a>`;
}

function fmtPrice(value) {
  if (!Number.isFinite(value)) return "$0.0000";
  return `$${value.toFixed(4)}`;
}

function fmtUsd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  return `$${value.toFixed(2)}`;
}

function fmtRoundedUsd(value) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${Math.ceil(value)}`;
}

function fmtSignedUsd(value) {
  if (!Number.isFinite(value)) return "$0.00";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
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

function titleLine(input) {
  return `${input.emoji} ${input.strategyLabel}`;
}

function toAccountLines(account) {
  return [
    "Account Update:",
    `Eq: ${fmtUsd(account.equityUsd)} | Cash: ${fmtUsd(account.cashUsd)}`,
    `M: ${fmtUsd(account.marginInUseUsd)} | N: ${fmtUsd(account.openNotionalUsd)}`
  ];
}

export function buildEntryAvailableTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "🟢 Entry Available:",
    "",
    `${ticker}:`,
    `Bybit: E: ${fmtPrice(input.bybitPriceAtAlert)}`,
    `Mexc:  E: ${fmtPrice(input.mexcPriceAtAlert)}`,
    "",
    `Margin: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    "",
    `    ${Number(input.sellRatioNow ?? 0).toFixed(4)}`,
    `    ${Number(input.hourVolumeNow ?? 0).toLocaleString()}`,
    `    ${Number(input.currentOpenTrades ?? 0)}`
  ].join("\n");
}

export function buildReplacementAvailableTelegramMessage(input) {
  const loserTicker = buildTickerLink(input.tickerDeepLinkTemplate, input.loserSymbol);
  const newTicker = buildTickerLink(input.tickerDeepLinkTemplate, input.newSymbol);

  return [
    titleLine(input),
    "🚨 Replacement:",
    "",
    `Loser: ${loserTicker} - Bybit: E: ${fmtPrice(input.loserBybitEntryPrice)} | C: ${fmtPrice(input.loserBybitCurrentPrice)}`,
    `    E: ${fmtPrice(input.loserEntryPrice)} | PNL: ${fmtPct(input.loserPnlPct)} / ${fmtSignedUsd(input.loserPnlUsd)}  | ${fmtAge(input.loserAge)}`,
    `    C: ${fmtPrice(input.loserCurrentPrice)} | TP: ${fmtPrice(input.loserTakeProfitPrice)} | L: ${fmtPrice(input.loserLiquidationPrice)}`,
    "",
    "New:",
    `${newTicker}:`,
    `Bybit: E: ${fmtPrice(input.newBybitPriceAtAlert)}`,
    `Mexc:  E: ${fmtPrice(input.newMexcPriceAtAlert)}`,
    "",
    `Margin: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    "",
    `    ${Number(input.newSellRatioNow ?? 0).toFixed(4)}`,
    `    ${Number(input.newHourVolumeNow ?? 0).toLocaleString()}`,
    `    ${Number(input.loserPnlPct ?? 0).toFixed(2)}%`
  ].join("\n");
}

export function buildTrackDecisionTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "🧭 External Position Detected:",
    "",
    `${ticker}`,
    `E: ${fmtPrice(input.entryPrice)} | TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`
  ].join("\n");
}

export function buildExitAvailableTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);
  const icon = input.pnlPct >= 0 ? "✅" : "❌";

  return [
    titleLine(input),
    `${icon}EXIT: ${input.reason}`,
    "",
    `${ticker} - Bybit: E: ${fmtPrice(input.bybitEntryPrice)} | C: ${fmtPrice(input.bybitCurrentPrice)}`,
    `    E: ${fmtPrice(input.entryPrice)} | PNL: ${fmtPct(input.pnlPct)} / ${fmtSignedUsd(input.pnlUsd)}  | ${fmtAge(input.age)}`,
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
    `E: ${fmtPrice(input.entryPrice)} | RE: ${fmtPrice(input.realizedEntryPrice)}`,
    `TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`,
    "",
    `Entry Slippage: ${fmtBps(input.entrySlippageBps)}`,
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildExitConfirmedTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);
  const icon = input.pnlUsd >= 0 ? "✅" : "❌";

  return [
    titleLine(input),
    `${icon}EXIT: ${input.reason}`,
    "",
    `${ticker}:`,
    `PNL: ${fmtSignedUsd(input.pnlUsd)} | ${fmtPct(input.pnlPct)}`,
    `Exit Slippage: ${fmtBps(input.exitSlippageBps)}`,
    `Roundtrip Slippage: ${fmtBps(input.roundtripSlippageBps)}`,
    `Funding: ${fmtSignedUsd(input.fundingUsd ?? 0)}`,
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildWaitingForConfirmationMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    titleLine(input),
    "⏳ Waiting for trade confirmation:",
    "",
    `${ticker}`,
    ""
  ].join("\n");
}

export function buildFundingTelegramMessage(input) {
  const lines = [];
  for (let i = 0; i < input.updates.length; i += 1) {
    const item = input.updates[i];
    const ticker = buildTickerLink(input.tickerDeepLinkTemplate, item.symbol);
    lines.push(`${i + 1}. ${ticker}: ${fmtSignedUsd(item.fundingUsd)} | Net: ${fmtSignedUsd(item.netFundingUsd)}`);
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
  return [
    `${index}. ${buildTickerLink(item.tickerDeepLinkTemplate, item.symbol)} - Bybit: E: ${fmtPrice(item.bybitEntryPrice)} | C: ${fmtPrice(item.bybitCurrentPrice)}`,
    `      E: ${fmtPrice(item.entryPrice)} | PNL: ${fmtPct(item.pnlPct)} / ${fmtSignedUsd(item.pnlUsd)} | ${fmtAge(item.age)}`,
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

function buildManualExitLines(input) {
  if (!Array.isArray(input.manualExitCandidates)) return [];

  const items = input.manualExitCandidates;
  const lines = [
    "",
    "Manual Action Required:",
    "Should Have Been Sold While Bot Was Offline:"
  ];

  if (items.length === 0) {
    lines.push("None");
    return lines;
  }

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const ticker = buildTickerLink(item.tickerDeepLinkTemplate, item.symbol);
    lines.push(`${i + 1}. ${ticker} | ${item.reason}`);
  }

  return lines;
}

export function buildStrategyStatusTelegramMessage(input) {
  const positionLines = buildOpenPositionLines(input);
  const manualExitLines = buildManualExitLines(input);

  return [
    titleLine(input),
    "📈 Open Positions",
    "",
    ...positionLines,
    ...manualExitLines,
    "",
    "<b>Live Stats:</b>",
    "",
    `PNL: ${fmtPct(input.live.pnlPct)} | ${fmtSignedUsd(input.live.pnlUsd)}`,
    `Unrealized PNL: ${fmtSignedUsd(input.live.unrealizedPnlUsd)} | ${fmtPct(input.live.unrealizedPnlPct)}`,
    "",
    `Entries: ${input.live.entries} | O: ${input.live.openTrades} | M: ${input.live.missed}`,
    `Winners: ${input.live.winners} | Losers: ${input.live.losers}  | Win %: ${fmtPct(input.live.winPct)}`,
    `Replaced: ${input.live.replaced}| Liq'd: ${input.live.liquidations}`,
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
