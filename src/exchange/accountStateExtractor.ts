/**
 * Extracts account-level balance/equity metrics from exchange snapshots.
 * Used as live source-of-truth when account endpoints are configured.
 */
import { CollectedEndpoint, FuturesSnapshot } from "./types.js";

export interface ExchangeAccountState {
  equityUsd?: number;
  cashUsd?: number;
  marginInUseUsd?: number;
  openNotionalUsd?: number;
  unrealizedPnlUsd?: number;
  sourceEndpoint: string;
}

interface CandidateState {
  equityUsd: number | undefined;
  cashUsd: number | undefined;
  marginInUseUsd: number | undefined;
  openNotionalUsd: number | undefined;
  unrealizedPnlUsd: number | undefined;
  score: number;
}

const ACCOUNT_KEYWORDS = ["account", "wallet", "balance", "asset", "margin", "position", "equity", "risk"];

const EQUITY_KEYS = new Set([
  "equity",
  "equityusd",
  "totalequity",
  "totalequityusd",
  "accountequity",
  "marginbalance",
  "walletbalance",
  "totalmarginbalance"
]);

const CASH_KEYS = new Set([
  "cash",
  "cashusd",
  "available",
  "availablebalance",
  "availablemargin",
  "availablefunds",
  "availableusd",
  "free",
  "freebalance",
  "walletavailablebalance"
]);

const MARGIN_KEYS = new Set([
  "margininuse",
  "marginused",
  "usedmargin",
  "positionmargin",
  "initialmargin",
  "totalinitialmargin",
  "totalpositionim",
  "positionim"
]);

const NOTIONAL_KEYS = new Set([
  "opennotional",
  "opennotionalusd",
  "positionvalue",
  "totalpositionvalue",
  "positionnotional",
  "notional"
]);

const UNREALIZED_KEYS = new Set([
  "unrealizedpnl",
  "unrealizedpnlusd",
  "totalunrealizedpnl",
  "upl"
]);

function parseNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAccountEndpoint(endpoint: CollectedEndpoint): boolean {
  const name = endpoint.name.toLowerCase();
  if (ACCOUNT_KEYWORDS.some((key) => name.includes(key))) return true;

  return endpoint.tags.some((tag) => {
    const lower = String(tag).toLowerCase();
    return ACCOUNT_KEYWORDS.some((key) => lower.includes(key));
  });
}

function extractObjects(payload: unknown, maxObjects = 600): Record<string, unknown>[] {
  const queue: unknown[] = [payload];
  const objects: Record<string, unknown>[] = [];

  while (queue.length > 0 && objects.length < maxObjects) {
    const current = queue.shift();

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    if (!current || typeof current !== "object") continue;

    const asObj = current as Record<string, unknown>;
    objects.push(asObj);

    for (const value of Object.values(asObj)) {
      if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return objects;
}

function findMetric(obj: Record<string, unknown>, keySet: Set<string>, fuzzyToken?: string): number | undefined {
  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = normalizeKey(rawKey);
    const parsed = parseNumber(rawValue);
    if (parsed === null) continue;

    if (keySet.has(key)) {
      return parsed;
    }

    if (fuzzyToken && key.includes(fuzzyToken)) {
      return parsed;
    }
  }

  return undefined;
}

function scoreCandidate(candidate: CandidateState): number {
  let score = 0;

  if (Number.isFinite(candidate.equityUsd)) score += 3;
  if (Number.isFinite(candidate.cashUsd)) score += 2;
  if (Number.isFinite(candidate.marginInUseUsd)) score += 1;
  if (Number.isFinite(candidate.openNotionalUsd)) score += 1;
  if (Number.isFinite(candidate.unrealizedPnlUsd)) score += 1;

  return score;
}

function bestCandidateFromEndpoint(endpoint: CollectedEndpoint): CandidateState | null {
  const objects = extractObjects(endpoint.payload);

  let best: CandidateState | null = null;

  for (const obj of objects) {
    const candidate: CandidateState = {
      equityUsd: findMetric(obj, EQUITY_KEYS, "equity"),
      cashUsd: findMetric(obj, CASH_KEYS, "available"),
      marginInUseUsd: findMetric(obj, MARGIN_KEYS, "margin"),
      openNotionalUsd: findMetric(obj, NOTIONAL_KEYS, "positionvalue"),
      unrealizedPnlUsd: findMetric(obj, UNREALIZED_KEYS, "unrealized"),
      score: 0
    };

    if (
      candidate.equityUsd === undefined &&
      candidate.cashUsd === undefined &&
      candidate.marginInUseUsd === undefined &&
      candidate.openNotionalUsd === undefined &&
      candidate.unrealizedPnlUsd === undefined
    ) {
      continue;
    }

    candidate.score = scoreCandidate(candidate);

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function withDerivedValues(candidate: CandidateState): CandidateState {
  const next: CandidateState = { ...candidate };

  if (next.cashUsd === undefined && next.equityUsd !== undefined && next.marginInUseUsd !== undefined) {
    next.cashUsd = next.equityUsd - next.marginInUseUsd;
  }

  if (next.equityUsd === undefined && next.cashUsd !== undefined && next.marginInUseUsd !== undefined) {
    next.equityUsd = next.cashUsd + next.marginInUseUsd;
  }

  return {
    ...next,
    score: scoreCandidate(next)
  };
}

export function extractExchangeAccountState(snapshot: FuturesSnapshot): ExchangeAccountState | null {
  const accountEndpoints = snapshot.endpoints.filter(isAccountEndpoint);
  if (accountEndpoints.length === 0) return null;

  let best: { candidate: CandidateState; sourceEndpoint: string } | null = null;

  for (const endpoint of accountEndpoints) {
    const candidateRaw = bestCandidateFromEndpoint(endpoint);
    if (!candidateRaw) continue;

    const candidate = withDerivedValues(candidateRaw);

    if (!best || candidate.score > best.candidate.score) {
      best = {
        candidate,
        sourceEndpoint: endpoint.name
      };
    }
  }

  if (!best) return null;
  const result: ExchangeAccountState = {
    sourceEndpoint: best.sourceEndpoint
  };

  if (best.candidate.equityUsd !== undefined) result.equityUsd = best.candidate.equityUsd;
  if (best.candidate.cashUsd !== undefined) result.cashUsd = best.candidate.cashUsd;
  if (best.candidate.marginInUseUsd !== undefined) result.marginInUseUsd = best.candidate.marginInUseUsd;
  if (best.candidate.openNotionalUsd !== undefined) result.openNotionalUsd = best.candidate.openNotionalUsd;
  if (best.candidate.unrealizedPnlUsd !== undefined) result.unrealizedPnlUsd = best.candidate.unrealizedPnlUsd;

  return result;
}
