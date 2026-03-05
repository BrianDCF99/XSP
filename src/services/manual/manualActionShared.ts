/**
 * Shared types and pure helpers for manual action services.
 */
import { OpenPositionRecord } from "../../db/repos/tradeRepository.js";
import { MexcAsset, MexcHistoryOrder, MexcHistoryPosition, MexcOpenPosition } from "../../exchange/mexc/mexcPrivateClient.js";
import { PositionEvent } from "../../strategies/types.js";

export interface StrategyTelegramModule {
  STRATEGY_LABEL?: string;
  STRATEGY_EMOJI?: string;
  ENTRY_TRACK_DEFAULTS?: {
    takeProfitUnlevered?: number;
    entryFeeBps?: number;
    entrySlippageBps?: number;
  };
  buildEntryAvailableTelegramMessage?: (input: any) => string;
  buildExitAvailableTelegramMessage?: (input: any) => string;
  buildReplacementAvailableTelegramMessage?: (input: any) => string;
  buildEntryConfirmedTelegramMessage?: (input: any) => string;
  buildExitConfirmedTelegramMessage?: (input: any) => string;
  buildFundingTelegramMessage?: (input: any) => string;
  buildWaitingForConfirmationMessage?: (input: any) => string;
  buildTrackDecisionTelegramMessage?: (input: any) => string;
}

export interface AccountState {
  equityUsd: number;
  cashUsd: number;
  marginInUseUsd: number;
  openNotionalUsd: number;
  unrealizedPnlUsd: number;
  netFundingUsd: number;
}

export interface FundingDetectedUpdate {
  symbol: string;
  fundingUsd: number;
  netFundingUsd: number;
  sourcePosition: MexcOpenPosition;
  dbPosition: OpenPositionRecord;
}

export interface RecentExitAlertContext {
  type: PositionEvent["type"] | null;
  reason: string | null;
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function positiveFiniteNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || n <= 0) return null;
  return n;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

export function fundingAmount(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

export function sameFunding(a: number, b: number, epsilon = 0.000001): boolean {
  return Math.abs(a - b) < epsilon;
}

export function isShortPosition(position: MexcOpenPosition | MexcHistoryPosition): boolean {
  return asNumber(position.positionType, 2) === 2;
}

export function isOpenPosition(position: MexcOpenPosition): boolean {
  return asNumber(position.holdVol, 0) > 0;
}

export function calcShortPnlPct(entryPrice: number, exitPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(exitPrice) || exitPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;

  const unlevered = (entryPrice - exitPrice) / entryPrice;
  return unlevered * leverage * 100;
}

export function calcShortPnlUsd(
  entryPrice: number,
  currentPrice: number,
  notionalUsd: number,
  marginUsd: number,
  leverage: number
): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;

  const move = (entryPrice - currentPrice) / entryPrice;
  if (Number.isFinite(notionalUsd) && notionalUsd > 0) {
    return notionalUsd * move;
  }

  if (!Number.isFinite(marginUsd) || marginUsd <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return marginUsd * leverage * move;
}

export function calcMarginToPutRounded(cashUsd: number, capUsd = 500, pct = 0.01): number {
  if (!Number.isFinite(cashUsd) || cashUsd <= 0) return 0;
  const raw = Math.min(capUsd, cashUsd * pct);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.ceil(raw);
}

export function calcRoundtripSlippageBps(entrySlippageBps: number | null, exitSlippageBps: number | undefined): number | undefined {
  if (entrySlippageBps === null) return undefined;
  if (typeof exitSlippageBps !== "number" || !Number.isFinite(exitSlippageBps)) return undefined;
  return entrySlippageBps + exitSlippageBps;
}

export function historyEpochMs(value: unknown): number | null {
  const raw = asNumber(value, 0);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return raw < 10_000_000_000 ? raw * 1000 : raw;
}

function historyPositionEventTimeMs(position: MexcHistoryPosition): number | null {
  return historyEpochMs(position.updateTime) ?? historyEpochMs(position.closeTime) ?? historyEpochMs(position.createTime);
}

function historyOrderEventTimeMs(order: MexcHistoryOrder): number | null {
  return historyEpochMs(order.updateTime) ?? historyEpochMs(order.createTime);
}

export function orderSlippageBps(order: MexcHistoryOrder | null | undefined): number | undefined {
  if (!order) return undefined;
  const expected = positiveFiniteNumber(order.price);
  const realized = positiveFiniteNumber(order.dealAvgPrice);
  if (expected === null || realized === null) return undefined;
  return ((realized - expected) / expected) * 10_000;
}

export function normalizeSlippageBps(
  rawBps: number | null | undefined,
  side: PositionEvent["side"],
  leg: "ENTRY" | "EXIT"
): number | undefined {
  if (typeof rawBps !== "number" || !Number.isFinite(rawBps)) return undefined;
  const shouldFlip = (side === "SHORT" && leg === "EXIT") || (side === "LONG" && leg === "ENTRY");
  return shouldFlip ? -rawBps : rawBps;
}

export function orderRealizedPrice(order: MexcHistoryOrder | null | undefined): number | undefined {
  if (!order) return undefined;
  const realized = positiveFiniteNumber(order.dealAvgPrice);
  return realized === null ? undefined : realized;
}

export function pickBestHistoryOrder(
  history: MexcHistoryOrder[],
  symbol: string,
  side: number,
  minTimeMs: number,
  targetTimeMs?: number
): MexcHistoryOrder | null {
  const target = normalizeSymbol(symbol);
  const base = history
    .filter((row) => normalizeSymbol(row.symbol) === target)
    .filter((row) => asNumber(row.side, 0) === side)
    .filter((row) => asNumber(row.state, 0) === 3)
    .filter((row) => asNumber(row.dealVol, 0) > 0)
    .map((row) => ({ row, timeMs: historyOrderEventTimeMs(row) }))
    .filter((item) => item.timeMs !== null && item.timeMs >= minTimeMs) as Array<{ row: MexcHistoryOrder; timeMs: number }>;

  if (base.length === 0) return null;

  if (typeof targetTimeMs === "number" && Number.isFinite(targetTimeMs) && targetTimeMs > 0) {
    base.sort((a, b) => {
      const aDistance = Math.abs(a.timeMs - targetTimeMs);
      const bDistance = Math.abs(b.timeMs - targetTimeMs);
      if (aDistance !== bDistance) return aDistance - bDistance;
      return b.timeMs - a.timeMs;
    });
    return base[0]!.row;
  }

  base.sort((a, b) => b.timeMs - a.timeMs);
  return base[0]!.row;
}

export function mapExpectedEventType(value: unknown): PositionEvent["type"] {
  const raw = typeof value === "string" ? value.toUpperCase() : "";
  if (raw === "LIQUIDATION") return "LIQUIDATION";
  if (raw === "REPLACE") return "REPLACE";
  return "EXIT";
}

export function shortLiquidationPrice(entryPrice: number, leverage: number): number {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (!Number.isFinite(leverage) || leverage <= 0) return 0;
  return entryPrice * (1 + 1 / leverage);
}

export function positionAge(entryTimeIso: string, nowIsoValue: string): string {
  const startMs = Date.parse(entryTimeIso);
  const endMs = Date.parse(nowIsoValue);
  const diffMs = Math.max(0, endMs - startMs);
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return `${String(days).padStart(2, "0")}-${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function resolveEmoji(strategyName: string, module: StrategyTelegramModule): string {
  if (module.STRATEGY_EMOJI && module.STRATEGY_EMOJI.length > 0) return module.STRATEGY_EMOJI;
  return "🎯";
}

export function resolveStrategyLabel(strategyName: string, module: StrategyTelegramModule): string {
  if (module.STRATEGY_LABEL && module.STRATEGY_LABEL.length > 0) return module.STRATEGY_LABEL;
  return strategyName.toUpperCase();
}

export function accountFromMexc(openPositions: MexcOpenPosition[], assets: MexcAsset[]): AccountState {
  const usdt = assets.find((asset) => (asset.currency ?? "").toUpperCase() === "USDT");
  if (!usdt) {
    throw new Error("MEXC live account payload missing USDT asset");
  }

  const equity = finiteNumber(usdt.equity);
  const cash = finiteNumber(usdt.cashBalance);
  const margin = finiteNumber(usdt.positionMargin);
  const unrealized = finiteNumber(usdt.unrealized);

  if (equity === null || cash === null || margin === null || unrealized === null) {
    throw new Error("MEXC live account payload missing required USDT equity/cash/margin/unrealized fields");
  }

  // Some MEXC rows omit positionValue on newly-opened or low-liquidity contracts.
  // Keep runtime resilient by estimating notional from other numeric fields.
  const positionNotionalUsd = (p: MexcOpenPosition): number => {
    const direct = positiveFiniteNumber(p.positionValue);
    if (direct !== null) return direct;

    const leverage = positiveFiniteNumber(p.leverage);
    const marginLike =
      positiveFiniteNumber(p.im) ??
      positiveFiniteNumber(p.oim) ??
      positiveFiniteNumber(p.positionMargin);
    if (leverage !== null && marginLike !== null) {
      return marginLike * leverage;
    }

    const qty = positiveFiniteNumber(p.holdVol);
    const entry = positiveFiniteNumber(p.openAvgPrice);
    if (qty !== null && entry !== null) {
      return qty * entry;
    }

    return 0;
  };

  const notionalFromPositions = openPositions.reduce((sum, p) => {
    return sum + positionNotionalUsd(p);
  }, 0);
  const netFundingUsd = openPositions.reduce((sum, p) => {
    const funding = finiteNumber(p.fundingFee);
    return sum + (funding ?? 0);
  }, 0);

  return {
    equityUsd: equity,
    cashUsd: cash,
    marginInUseUsd: margin,
    openNotionalUsd: notionalFromPositions,
    unrealizedPnlUsd: unrealized,
    netFundingUsd
  };
}

export function pickBestHistoryPosition(history: MexcHistoryPosition[], symbol: string, minTimeMs: number): MexcHistoryPosition | null {
  const filtered = history
    .filter((row) => normalizeSymbol(row.symbol) === symbol)
    .filter((row) => isShortPosition(row))
    .filter((row) => asNumber(row.closeVol, 0) > 0)
    .filter((row) => {
      const timeMs = historyPositionEventTimeMs(row);
      return timeMs !== null && timeMs >= minTimeMs;
    })
    .sort((a, b) => {
      const aMs = historyPositionEventTimeMs(a) ?? 0;
      const bMs = historyPositionEventTimeMs(b) ?? 0;
      return bMs - aMs;
    });

  return filtered[0] ?? null;
}

export function historyPositionEventTimeIso(position: MexcHistoryPosition, fallbackIso = nowIso()): string {
  const ms = historyPositionEventTimeMs(position);
  if (ms === null) return fallbackIso;
  return new Date(ms).toISOString();
}

export function historyOrderEventTimeIso(order: MexcHistoryOrder, fallbackIso = nowIso()): string {
  const ms = historyOrderEventTimeMs(order);
  if (ms === null) return fallbackIso;
  return new Date(ms).toISOString();
}

export function defaultAccountState(): AccountState {
  return {
    equityUsd: 0,
    cashUsd: 0,
    marginInUseUsd: 0,
    openNotionalUsd: 0,
    unrealizedPnlUsd: 0,
    netFundingUsd: 0
  };
}
