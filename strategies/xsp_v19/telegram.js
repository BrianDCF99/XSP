/**
 * XSP V19 Telegram message formatter.
 * Spacing intentionally mirrors TG_Messages.md templates.
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

function toAccountLines(account) {
  return [
    "Account Update:",
    `Eq: ${fmtUsd(account.equityUsd)} | Cash: ${fmtUsd(account.cashUsd)}`,
    `M: ${fmtUsd(account.marginInUseUsd)} | N: ${fmtUsd(account.openNotionalUsd)}`
  ];
}

function toPositionSnapshotLines(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    `${ticker}`,
    `    E: ${fmtPrice(input.entryPrice)} | PNL: ${fmtPct(input.pnlPct)} / ${fmtSignedUsd(input.pnlUsd)}  | ${input.age}`,
    `    C: ${fmtPrice(input.currentPrice)} | TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`
  ];
}

export function buildEntryAvailableTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    "🟢 Entry Available:",
    "",
    `${ticker}: ${fmtPrice(input.priceAtAlert)} | M: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    `    - Sell Ratio &lt;= ${input.sellRatioMax} (now: ${Number(input.sellRatioNow ?? 0).toFixed(4)})`,
    `    - Volume >= ${Number(input.minHourVolume ?? 0).toLocaleString()} (now: ${Number(input.hourVolumeNow ?? 0).toLocaleString()})`,
    `    - Live trades &lt; ${input.concurrentCap} (now: ${input.currentOpenTrades})`
  ].join("\n");
}

export function buildReplacementAvailableTelegramMessage(input) {
  const loserLines = toPositionSnapshotLines({
    tickerDeepLinkTemplate: input.tickerDeepLinkTemplate,
    symbol: input.loserSymbol,
    entryPrice: input.loserEntryPrice,
    pnlPct: input.loserPnlPct,
    pnlUsd: input.loserPnlUsd,
    age: input.loserAge,
    currentPrice: input.loserCurrentPrice,
    takeProfitPrice: input.loserTakeProfitPrice,
    liquidationPrice: input.loserLiquidationPrice
  });

  const newTicker = buildTickerLink(input.tickerDeepLinkTemplate, input.newSymbol);

  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    "🚨 Replacement:",
    "",
    `Loser: ${loserLines[0]}`,
    loserLines[1],
    loserLines[2],
    "",
    "New:",
    `${newTicker}: ${fmtPrice(input.newPriceAtAlert)} | M: ${fmtRoundedUsd(Number(input.marginToPut ?? 0))}`,
    `    - Sell Ratio &lt;= ${input.sellRatioMax} (now: ${Number(input.newSellRatioNow ?? 0).toFixed(4)})`,
    `    - Volume >= ${Number(input.minHourVolume ?? 0).toLocaleString()} (now: ${Number(input.newHourVolumeNow ?? 0).toLocaleString()})`
  ].join("\n");
}

export function buildTrackDecisionTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
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
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    `${icon}EXIT: ${input.reason}`,
    "",
    `${ticker}`,
    `    E: ${fmtPrice(input.entryPrice)} | PNL: ${fmtPct(input.pnlPct)} / ${fmtSignedUsd(input.pnlUsd)}  | ${input.age}`,
    `    C: ${fmtPrice(input.currentPrice)} | TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`
  ].join("\n");
}

export function buildEntryConfirmedTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);

  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    "🍀 Opened Trade:",
    "",
    `${ticker}`,
    `E: ${fmtPrice(input.entryPrice)} | RE: ${fmtPrice(input.realizedEntryPrice)} TP: ${fmtPrice(input.takeProfitPrice)} | L: ${fmtPrice(input.liquidationPrice)}`,
    `Entry Slippage: ${fmtBps(input.entrySlippageBps)}`,
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildExitConfirmedTelegramMessage(input) {
  const ticker = buildTickerLink(input.tickerDeepLinkTemplate, input.symbol);
  const icon = input.pnlUsd >= 0 ? "✅" : "❌";

  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
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
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    "⏳ Waiting for trade confirmation:",
    `${ticker}`,
    "Bot will keep polling MEXC and send confirmed update once fill appears."
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
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
    "💸 Fudnding Update:",
    "",
    ...lines,
    "",
    ...toAccountLines(input.account)
  ].join("\n");
}

export function buildInfoCommandMessage(input) {
  return [
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
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
    "    Sell Ratio Delta from entry: 0.1",
    "    Replacement"
  ].join("\n");
}

function buildOpenPositionBlock(index, item) {
  return [
    `${index}. ${buildTickerLink(item.tickerDeepLinkTemplate, item.symbol)}`,
    `      E: ${fmtPrice(item.entryPrice)} | PNL: ${fmtPct(item.pnlPct)} / ${fmtSignedUsd(item.pnlUsd)}  | ${item.age}`,
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
    `${input.emoji} ${input.exchange}: ${input.strategyLabel}`,
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
  return `${input.emoji} ${input.exchange}: ${input.strategyLabel}\n📈 Open Positions\n\nNo new entry signals this cycle.`;
}
