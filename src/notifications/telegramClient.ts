/**
 * Telegram delivery adapter.
 */
import { RuntimeConfig } from "../config/schema.js";
import { TelegramReplyMarkup } from "../strategies/types.js";
import { Logger } from "../utils/logger.js";
import {
  buildAnswerCallbackBody,
  buildAnswerCallbackQueryUrl,
  buildEditMessageTextBody,
  buildEditMessageTextUrl,
  buildGetUpdatesBody,
  buildGetUpdatesUrl,
  buildSendMessageBody,
  buildSendMessageUrl
} from "./telegramRequestBuilder.js";
import { extractTelegramMessageId, isTelegramSendSuccess, isTelegramUpdatesSuccess } from "./telegramResponse.js";
import { TelegramApiResponse, TelegramUpdate, TelegramUpdatesApiResponse } from "./telegramTypes.js";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MESSAGE_NOT_MODIFIED = "message is not modified";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class TelegramClient {
  private readonly opportunityMessageIds = new Map<string, number>();
  private opportunityUpsertMode = false;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger
  ) {}

  isEnabled(): boolean {
    return this.cfg.telegram.enabled;
  }

  async sendMessage(text: string, replyMarkup?: TelegramReplyMarkup): Promise<number | null> {
    this.setOpportunityUpsertMode(false);
    return this.sendMessageInternal(text, replyMarkup);
  }

  setOpportunityUpsertMode(enabled: boolean): void {
    if (enabled) {
      if (!this.opportunityUpsertMode) {
        this.opportunityUpsertMode = true;
        this.invalidateOpportunityChain();
      }
      return;
    }

    if (!this.opportunityUpsertMode && this.opportunityMessageIds.size === 0) return;
    this.opportunityUpsertMode = false;
    this.invalidateOpportunityChain();
  }

  async upsertOpportunityMessage(
    symbol: string,
    text: string,
    replyMarkup?: TelegramReplyMarkup
  ): Promise<number | null> {
    if (!this.isEnabled()) return null;
    if (!this.opportunityUpsertMode) {
      return this.sendMessageInternal(text, replyMarkup);
    }

    const normalizedSymbol = this.normalizeSymbol(symbol);
    if (normalizedSymbol.length === 0) {
      return this.sendMessageInternal(text, replyMarkup);
    }

    const existingMessageId = this.opportunityMessageIds.get(normalizedSymbol);
    if (typeof existingMessageId === "number") {
      const editedMessageId = await this.editMessageText(existingMessageId, text, replyMarkup);
      if (editedMessageId !== null) {
        this.opportunityMessageIds.set(normalizedSymbol, editedMessageId);
        return editedMessageId;
      }
    }

    const sentMessageId = await this.sendMessageInternal(text, replyMarkup);
    if (sentMessageId !== null) {
      this.opportunityMessageIds.set(normalizedSymbol, sentMessageId);
    }
    return sentMessageId;
  }

  private async sendMessageInternal(text: string, replyMarkup?: TelegramReplyMarkup): Promise<number | null> {
    if (!this.isEnabled()) return null;

    const url = buildSendMessageUrl(this.cfg);
    const body = buildSendMessageBody(this.cfg, text, replyMarkup);

    try {
      const res = await this.postJsonWithRetry("sendMessage", url, body);
      const data = await this.parseJson<TelegramApiResponse>(res, "sendMessage");
      if (!data) return null;

      if (!isTelegramSendSuccess(res.ok, data)) {
        this.logFailure("sendMessage", res.status, data.description ?? "unknown");
        return null;
      }

      return extractTelegramMessageId(data);
    } catch (error) {
      this.logRequestError("sendMessage", url, error);
      return null;
    }
  }

  private async editMessageText(
    messageId: number,
    text: string,
    replyMarkup?: TelegramReplyMarkup
  ): Promise<number | null> {
    if (!this.isEnabled()) return null;

    const url = buildEditMessageTextUrl(this.cfg);
    const body = buildEditMessageTextBody(this.cfg, messageId, text, replyMarkup);

    try {
      const res = await this.postJsonWithRetry("editMessageText", url, body);
      const data = await this.parseJson<TelegramApiResponse>(res, "editMessageText");
      if (!data) return null;

      if (!isTelegramSendSuccess(res.ok, data)) {
        const description = String(data.description ?? "unknown");
        if (res.status === 400 && description.toLowerCase().includes(MESSAGE_NOT_MODIFIED)) {
          return messageId;
        }

        this.logFailure("editMessageText", res.status, description);
        return null;
      }

      return extractTelegramMessageId(data) ?? messageId;
    } catch (error) {
      this.logRequestError("editMessageText", url, error);
      return null;
    }
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    if (!this.isEnabled()) return [];

    const url = buildGetUpdatesUrl(this.cfg);
    const body = buildGetUpdatesBody(this.cfg, offset);

    try {
      const res = await this.postJsonWithRetry("getUpdates", url, body);
      const data = await this.parseJson<TelegramUpdatesApiResponse>(res, "getUpdates");
      if (!data) return [];

      if (!isTelegramUpdatesSuccess(res.ok, data)) {
        this.logFailure("getUpdates", res.status, data.description ?? "unknown");
        return [];
      }

      return data.result ?? [];
    } catch (error) {
      this.logRequestError("getUpdates", url, error);
      return [];
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.isEnabled()) return;

    const url = buildAnswerCallbackQueryUrl(this.cfg);
    const body = buildAnswerCallbackBody(callbackQueryId, text);

    try {
      await this.postJsonWithRetry("answerCallbackQuery", url, body);
    } catch (error) {
      this.logRequestError("answerCallbackQuery", url, error);
    }
  }

  private invalidateOpportunityChain(): void {
    this.opportunityMessageIds.clear();
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.trim().toUpperCase();
  }

  private async postJsonWithRetry(operation: string, url: string, body: Record<string, unknown>): Promise<Response> {
    const maxRetries = this.cfg.telegram.maxRetries;
    const payload = JSON.stringify(body);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.postJson(url, payload);
        if (!this.shouldRetryByStatus(response.status) || attempt >= maxRetries) {
          return response;
        }

        const delayMs = this.computeRetryDelayMs(attempt, response.headers.get("retry-after"));
        this.logRetry(operation, url, attempt + 1, maxRetries + 1, {
          status: response.status,
          delayMs
        });
        await sleep(delayMs);
      } catch (error) {
        if (attempt >= maxRetries) {
          throw error;
        }

        const delayMs = this.computeRetryDelayMs(attempt);
        this.logRetry(operation, url, attempt + 1, maxRetries + 1, {
          delayMs,
          ...this.serializeError(error)
        });
        await sleep(delayMs);
      }
    }

    throw new Error("telegram retry loop failed unexpectedly");
  }

  private async postJson(url: string, payload: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.cfg.telegram.requestTimeoutMs);

    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: payload,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseJson<T>(res: Response, operation: string): Promise<T | null> {
    let raw = "";

    try {
      raw = await res.text();
      if (raw.length === 0) {
        this.logger.error("telegram response parse failed", {
          operation,
          status: res.status,
          error: "empty response body"
        });
        return null;
      }

      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.error("telegram response parse failed", {
        operation,
        status: res.status,
        error: error instanceof Error ? error.message : String(error),
        bodyPreview: raw.slice(0, 240)
      });
      return null;
    }
  }

  private logFailure(operation: string, status: number, description: string): void {
    this.logger.warn("telegram send failed", {
      operation,
      status,
      description
    });
  }

  private shouldRetryByStatus(status: number): boolean {
    return RETRYABLE_STATUSES.has(status);
  }

  private computeRetryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
    const retryAfterMs = this.parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs !== null) {
      return Math.min(retryAfterMs, this.cfg.telegram.retryMaxDelayMs);
    }

    const base = this.cfg.telegram.retryBaseDelayMs * 2 ** attempt;
    const capped = Math.min(base, this.cfg.telegram.retryMaxDelayMs);
    const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(capped * 0.25)));
    return capped + jitter;
  }

  private parseRetryAfterMs(retryAfterHeader?: string | null): number | null {
    if (!retryAfterHeader) return null;

    const trimmed = retryAfterHeader.trim();
    if (/^\d+$/.test(trimmed)) {
      return Math.max(0, Number(trimmed) * 1000);
    }

    const parsedDate = Date.parse(trimmed);
    if (!Number.isFinite(parsedDate)) return null;
    return Math.max(0, parsedDate - Date.now());
  }

  private sanitizeUrl(url: string): string {
    return url.replace(/\/bot[^/]+\//, "/bot<redacted>/");
  }

  private logRetry(
    operation: string,
    url: string,
    attempt: number,
    totalAttempts: number,
    meta: Record<string, unknown>
  ): void {
    this.logger.warn("telegram request retry scheduled", {
      operation,
      url: this.sanitizeUrl(url),
      attempt,
      totalAttempts,
      ...meta
    });
  }

  private logRequestError(operation: string, url: string, error: unknown): void {
    this.logger.error("telegram request failed", {
      operation,
      url: this.sanitizeUrl(url),
      ...this.serializeError(error)
    });
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
      return {
        error: String(error)
      };
    }

    const baseError = error as Error & {
      cause?: unknown;
      code?: string;
      errno?: string | number;
      syscall?: string;
      address?: string;
      port?: number;
    };

    const serialized: Record<string, unknown> = {
      error: baseError.message,
      errorName: baseError.name
    };

    if (baseError.code) serialized.errorCode = baseError.code;
    if (typeof baseError.errno !== "undefined") serialized.errorErrno = baseError.errno;
    if (baseError.syscall) serialized.errorSyscall = baseError.syscall;
    if (baseError.address) serialized.errorAddress = baseError.address;
    if (typeof baseError.port === "number") serialized.errorPort = baseError.port;

    if (typeof baseError.cause !== "undefined") {
      serialized.cause = this.serializeCause(baseError.cause);
    }

    if (error instanceof AggregateError) {
      serialized.aggregateErrors = Array.from(error.errors, (item) => this.serializeCause(item));
    }

    return serialized;
  }

  private serializeCause(cause: unknown): unknown {
    if (cause instanceof AggregateError) {
      return {
        type: "AggregateError",
        errors: Array.from(cause.errors, (item) => this.serializeCause(item))
      };
    }

    if (cause instanceof Error) {
      const base = cause as Error & {
        code?: string;
        errno?: string | number;
        syscall?: string;
        address?: string;
        port?: number;
        cause?: unknown;
      };

      const payload: Record<string, unknown> = {
        name: base.name,
        message: base.message
      };

      if (base.code) payload.code = base.code;
      if (typeof base.errno !== "undefined") payload.errno = base.errno;
      if (base.syscall) payload.syscall = base.syscall;
      if (base.address) payload.address = base.address;
      if (typeof base.port === "number") payload.port = base.port;
      if (typeof base.cause !== "undefined") payload.cause = this.serializeCause(base.cause);

      return payload;
    }

    if (typeof cause === "object" && cause !== null) {
      try {
        return JSON.parse(JSON.stringify(cause));
      } catch {
        return String(cause);
      }
    }

    return String(cause);
  }
}
