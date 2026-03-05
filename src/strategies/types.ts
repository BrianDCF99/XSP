/**
 * Contracts used between the core runtime and strategy workers.
 */
import { FuturesSnapshot } from "../exchange/types.js";
import { ExchangeAccountState } from "../exchange/accountStateExtractor.js";

export type StrategyMessageType = "ENTRY" | "EXIT" | "FUNDING" | "INFO" | "STATUS";

export type ManualAlertKind = "ENTRY_AVAILABLE" | "EXIT_AVAILABLE" | "REPLACEMENT_AVAILABLE" | "ENTRY_TRACK_DECISION";
export type ManualAlertButtonAction = "OPENED" | "CLOSED" | "REFRESH" | "TRACK" | "IGNORE" | "DECLINE";

export interface TelegramInlineButton {
  text: string;
  callbackData: string;
}

export interface TelegramReplyMarkup {
  inlineKeyboard: TelegramInlineButton[][];
}

export interface ManualAlertRequest {
  kind: ManualAlertKind;
  primarySymbol: string;
  secondarySymbol?: string;
  reason?: string;
  payload: Record<string, unknown>;
  buttons: ManualAlertButtonAction[];
}

export interface StrategyMessage {
  type: StrategyMessageType;
  text: string;
  symbol?: string;
  sendTelegram?: boolean;
  replyMarkup?: TelegramReplyMarkup;
  manualAlert?: ManualAlertRequest;
  manualAlertId?: string;
}

export type PositionEventType = "ENTRY" | "EXIT" | "REPLACE" | "LIQUIDATION" | "FUNDING";

export interface PositionEvent {
  type: PositionEventType;
  strategyName: string;
  symbol: string;
  exchange: string;
  side: "LONG" | "SHORT";
  eventTime: string;
  price: number;
  qty?: number;
  leverage?: number;
  marginUsd?: number;
  notionalUsd?: number;
  pnlPct?: number;
  pnlUsd?: number;
  reason?: string;
  fundingUsd?: number;
  takeProfitPrice?: number;
  entrySellRatio?: number;
  entrySlippageBps?: number;
  exitSlippageBps?: number;
  roundtripSlippageBps?: number;
}

export interface AccountSnapshotEvent {
  strategyName: string;
  observedAt: string;
  equityUsd: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  winners: number;
  losers: number;
  liquidations: number;
  replaced: number;
  entries: number;
  exits: number;
  openPositions: number;
  missed: number;
  netFundingUsd: number;
}

export interface StrategyOpenPosition {
  id: string;
  strategyName: string;
  symbol: string;
  exchange: string;
  side: "LONG" | "SHORT";
  entryTime: string;
  entryPrice: number;
  qty: number;
  leverage: number;
  marginUsd: number;
  notionalUsd: number;
  takeProfitPrice: number | null;
  entrySellRatio: number | null;
  entrySlippageBps: number | null;
}

export interface PreviousAccountSnapshot {
  observedAt: string;
  equityUsd: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  winners: number;
  losers: number;
  liquidations: number;
  replaced: number;
  entries: number;
  exits: number;
  openPositions: number;
  missed: number;
  netFundingUsd: number;
}

export interface StrategyWorkerInput {
  runId: string;
  strategyName: string;
  exchange: string;
  nowIso: string;
  tickerDeepLinkTemplate: string;
  snapshot: Readonly<FuturesSnapshot>;
  openPositions: ReadonlyArray<StrategyOpenPosition>;
  previousAccountSnapshot: PreviousAccountSnapshot | null;
  exchangeAccount: ExchangeAccountState | null;
}

export interface StrategyWorkerOutput {
  strategyName: string;
  messages: StrategyMessage[];
  positionEvents: PositionEvent[];
  accountSnapshot: AccountSnapshotEvent | null;
  trackedSymbols: string[];
}

export interface StrategyDescriptor {
  name: string;
  folderPath: string;
  modulePath: string;
  strategyMdPath: string;
  telegramMdPath: string;
  telegramModulePath: string;
}
