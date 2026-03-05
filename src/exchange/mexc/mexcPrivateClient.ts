/**
 * MEXC futures private API reader (signed requests, read-only endpoints).
 */
import crypto from "node:crypto";
import { RuntimeConfig } from "../../config/schema.js";

interface MexcEnvelope<T> {
  success: boolean;
  code: number;
  data: T;
  message?: string | undefined;
}

export interface MexcOpenPosition {
  positionId?: number | undefined;
  symbol: string;
  positionType?: number | undefined;
  holdVol?: number | undefined;
  openAvgPrice?: number | undefined;
  leverage?: number | undefined;
  liquidatePrice?: number | undefined;
  oim?: number | undefined;
  im?: number | undefined;
  positionMargin?: number | undefined;
  positionValue?: number | undefined;
  fundingFee?: number | undefined;
  createTime?: number | undefined;
  updateTime?: number | undefined;
}

export interface MexcHistoryPosition {
  positionId?: number | undefined;
  symbol: string;
  positionType?: number | undefined;
  holdVol?: number | undefined;
  closeVol?: number | undefined;
  openAvgPrice?: number | undefined;
  closeAvgPrice?: number | undefined;
  leverage?: number | undefined;
  oim?: number | undefined;
  im?: number | undefined;
  closeProfitLoss?: number | undefined;
  realised?: number | undefined;
  totalFee?: number | undefined;
  fundingFee?: number | undefined;
  positionShowStatus?: number | undefined;
  createTime?: number | undefined;
  updateTime?: number | undefined;
}

export interface MexcAsset {
  currency?: string | undefined;
  equity?: number | undefined;
  cashBalance?: number | undefined;
  positionMargin?: number | undefined;
  unrealized?: number | undefined;
}

interface CachedContractSize {
  contractSize: number;
  expiresAt: number;
}

function normalizeNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toQueryString(input: Record<string, string | number | undefined>): string {
  const keys = Object.keys(input)
    .filter((key) => input[key] !== undefined)
    .sort();

  return keys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(input[key]))}`)
    .join("&");
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function parseEnvelope<T>(payload: unknown): MexcEnvelope<T> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid MEXC response payload");
  }

  const body = payload as Record<string, unknown>;
  return {
    success: body.success === true,
    code: Number(body.code ?? -1),
    data: body.data as T,
    message: typeof body.message === "string" ? body.message : undefined
  };
}

function normalizeOpenPosition(row: unknown): MexcOpenPosition | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  const symbol = normalizeString(obj.symbol);
  if (!symbol) return null;

  return {
    positionId: normalizeNumber(obj.positionId),
    symbol,
    positionType: normalizeNumber(obj.positionType),
    holdVol: normalizeNumber(obj.holdVol),
    openAvgPrice: normalizeNumber(obj.openAvgPrice),
    leverage: normalizeNumber(obj.leverage),
    liquidatePrice: normalizeNumber(obj.liquidatePrice),
    oim: normalizeNumber(obj.oim),
    im: normalizeNumber(obj.im),
    positionMargin: normalizeNumber(obj.positionMargin),
    positionValue: normalizeNumber(obj.positionValue),
    fundingFee: normalizeNumber(
      obj.fundingFee ??
        obj.holdFee ??
        obj.hold_fee ??
        obj.funding_fee ??
        obj.totalFundingFee ??
        obj.total_funding_fee ??
        obj.historyFundingFee ??
        obj.history_funding_fee ??
        obj.accumulatedFunding ??
        obj.accumulated_funding
    ),
    createTime: normalizeNumber(obj.createTime),
    updateTime: normalizeNumber(obj.updateTime)
  };
}

function normalizeHistoryPosition(row: unknown): MexcHistoryPosition | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  const symbol = normalizeString(obj.symbol);
  if (!symbol) return null;

  return {
    positionId: normalizeNumber(obj.positionId),
    symbol,
    positionType: normalizeNumber(obj.positionType),
    holdVol: normalizeNumber(obj.holdVol),
    closeVol: normalizeNumber(obj.closeVol),
    openAvgPrice: normalizeNumber(obj.openAvgPrice),
    closeAvgPrice: normalizeNumber(obj.closeAvgPrice),
    leverage: normalizeNumber(obj.leverage),
    oim: normalizeNumber(obj.oim),
    im: normalizeNumber(obj.im),
    closeProfitLoss: normalizeNumber(obj.closeProfitLoss),
    realised: normalizeNumber(obj.realised),
    totalFee: normalizeNumber(obj.totalFee),
    fundingFee: normalizeNumber(obj.fundingFee ?? obj.holdFee ?? obj.hold_fee),
    positionShowStatus: normalizeNumber(obj.positionShowStatus),
    createTime: normalizeNumber(obj.createTime),
    updateTime: normalizeNumber(obj.updateTime)
  };
}

function normalizeAsset(row: unknown): MexcAsset | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;

  return {
    currency: normalizeString(obj.currency),
    equity: normalizeNumber(obj.equity),
    cashBalance: normalizeNumber(obj.cashBalance),
    positionMargin: normalizeNumber(obj.positionMargin),
    unrealized: normalizeNumber(obj.unrealized)
  };
}

export class MexcPrivateClient {
  private readonly baseUrl: string;
  private readonly recvWindowMs: number;
  private readonly contractSizeCache = new Map<string, CachedContractSize>();
  private readonly contractSizeTtlMs = 6 * 60 * 60 * 1000;

  constructor(private readonly cfg: RuntimeConfig) {
    const execution = cfg.exchange.execution;
    if (execution.name.toLowerCase() !== "mexc") {
      throw new Error(`MEXC private client requires execution exchange 'mexc' (received '${execution.name}')`);
    }

    const privateApi = execution.privateApi;
    this.baseUrl = (privateApi?.baseUrl ?? execution.restBaseUrl).replace(/\/$/, "");
    this.recvWindowMs = privateApi?.recvWindowMs ?? 10000;
  }

  async getOpenPositions(symbol?: string): Promise<MexcOpenPosition[]> {
    const rows = await this.signedGet<unknown[]>("/api/v1/private/position/open_positions", {
      symbol
    });

    const positions = rows
      .map((row) => normalizeOpenPosition(row))
      .filter((row): row is MexcOpenPosition => row !== null);

    await this.hydrateMissingPositionValues(positions);
    return positions;
  }

  async getHistoryPositions(input: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    pageNum?: number;
    pageSize?: number;
  }): Promise<MexcHistoryPosition[]> {
    const rows = await this.signedGet<unknown[]>("/api/v1/private/position/list/history_positions", {
      symbol: input.symbol,
      start_time: input.startTime,
      end_time: input.endTime,
      page_num: input.pageNum ?? 1,
      page_size: input.pageSize ?? 50
    });

    return rows
      .map((row) => normalizeHistoryPosition(row))
      .filter((row): row is MexcHistoryPosition => row !== null);
  }

  async getAccountAssets(): Promise<MexcAsset[]> {
    const rows = await this.signedGet<unknown[]>("/api/v1/private/account/assets", {});

    return rows
      .map((row) => normalizeAsset(row))
      .filter((row): row is MexcAsset => row !== null);
  }

  private async hydrateMissingPositionValues(positions: MexcOpenPosition[]): Promise<void> {
    const needsNotional = positions.filter((position) => {
      if (Number.isFinite(position.positionValue) && Number(position.positionValue) > 0) return false;
      if (!Number.isFinite(position.holdVol) || Number(position.holdVol) <= 0) return false;
      if (!Number.isFinite(position.openAvgPrice) || Number(position.openAvgPrice) <= 0) return false;
      return true;
    });

    if (needsNotional.length === 0) return;

    const symbols = [...new Set(needsNotional.map((position) => position.symbol.trim().toUpperCase()))];
    const contractSizeBySymbol = await this.resolveContractSizes(symbols);

    for (const position of needsNotional) {
      const symbol = position.symbol.trim().toUpperCase();
      const holdVol = Number(position.holdVol);
      const openAvgPrice = Number(position.openAvgPrice);

      const contractSize = contractSizeBySymbol.get(symbol);
      if (contractSize !== undefined && contractSize > 0) {
        position.positionValue = holdVol * openAvgPrice * contractSize;
        continue;
      }

      // Final fallback when contract metadata is temporarily unavailable.
      const marginLike = normalizeNumber(position.im) ?? normalizeNumber(position.oim) ?? normalizeNumber(position.positionMargin);
      const leverage = normalizeNumber(position.leverage);
      if (marginLike !== undefined && marginLike > 0 && leverage !== undefined && leverage > 0) {
        position.positionValue = marginLike * leverage;
      }
    }
  }

  private async resolveContractSizes(symbols: string[]): Promise<Map<string, number>> {
    const now = Date.now();
    const result = new Map<string, number>();
    const missing: string[] = [];

    for (const rawSymbol of symbols) {
      const symbol = rawSymbol.trim().toUpperCase();
      const cached = this.contractSizeCache.get(symbol);
      if (cached && cached.expiresAt > now) {
        result.set(symbol, cached.contractSize);
        continue;
      }
      missing.push(symbol);
    }

    if (missing.length === 0) {
      return result;
    }

    await Promise.all(
      missing.map(async (symbol) => {
        const size = await this.fetchContractSize(symbol);
        if (size !== undefined && size > 0) {
          this.contractSizeCache.set(symbol, {
            contractSize: size,
            expiresAt: now + this.contractSizeTtlMs
          });
          result.set(symbol, size);
        }
      })
    );

    return result;
  }

  private async fetchContractSize(symbol: string): Promise<number | undefined> {
    const query = toQueryString({ symbol });
    const url = query ? `${this.baseUrl}/api/v1/contract/detail?${query}` : `${this.baseUrl}/api/v1/contract/detail`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        }
      });

      const bodyText = await response.text();
      const json = JSON.parse(bodyText);
      const envelope = parseEnvelope<unknown>(json);
      if (!response.ok || !envelope.success || envelope.code !== 0) {
        return undefined;
      }

      if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
        return undefined;
      }

      const data = envelope.data as Record<string, unknown>;
      const contractSize = normalizeNumber(data.contractSize ?? data.contract_size ?? data.multiplier ?? data.multiple);
      if (contractSize === undefined || contractSize <= 0) {
        return undefined;
      }

      return contractSize;
    } catch {
      return undefined;
    }
  }

  private async signedGet<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const requestTime = Date.now();
    const query = toQueryString(params);
    const signaturePayload = `${this.cfg.env.mexcApiKey}${requestTime}${query}`;
    const signature = sign(this.cfg.env.mexcApiSecret, signaturePayload);

    const url = query ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        ApiKey: this.cfg.env.mexcApiKey,
        "Request-Time": String(requestTime),
        Signature: signature,
        "Recv-Window": String(this.recvWindowMs),
        "Content-Type": "application/json"
      }
    });

    const bodyText = await response.text();
    let json: unknown;

    try {
      json = JSON.parse(bodyText);
    } catch {
      throw new Error(`MEXC private API returned non-JSON (${response.status}): ${bodyText}`);
    }

    const envelope = parseEnvelope<T>(json);
    if (!response.ok || !envelope.success || envelope.code !== 0) {
      throw new Error(`MEXC private API failed (${response.status}/${envelope.code}): ${envelope.message ?? "unknown"}`);
    }

    return envelope.data;
  }
}
