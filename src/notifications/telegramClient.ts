/**
 * Telegram delivery adapter.
 */
import { RuntimeConfig } from "../config/schema.js";
import { TelegramReplyMarkup } from "../strategies/types.js";
import { Logger } from "../utils/logger.js";
import {
  buildAnswerCallbackBody,
  buildAnswerCallbackQueryUrl,
  buildGetUpdatesBody,
  buildGetUpdatesUrl,
  buildSendMessageBody,
  buildSendMessageUrl
} from "./telegramRequestBuilder.js";
import { extractTelegramMessageId, isTelegramSendSuccess, isTelegramUpdatesSuccess } from "./telegramResponse.js";
import { TelegramApiResponse, TelegramUpdate, TelegramUpdatesApiResponse } from "./telegramTypes.js";

export class TelegramClient {
  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger
  ) {}

  isEnabled(): boolean {
    return this.cfg.telegram.enabled;
  }

  async sendMessage(text: string, replyMarkup?: TelegramReplyMarkup): Promise<number | null> {
    if (!this.isEnabled()) return null;

    const url = buildSendMessageUrl(this.cfg);
    try {
      const res = await this.postMessage(url, text, replyMarkup);
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

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    if (!this.isEnabled()) return [];

    const url = buildGetUpdatesUrl(this.cfg);
    try {
      const res = await this.postGetUpdates(url, offset);
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
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      this.logRequestError("answerCallbackQuery", url, error);
    }
  }

  private async postMessage(url: string, text: string, replyMarkup?: TelegramReplyMarkup): Promise<Response> {
    const body = buildSendMessageBody(this.cfg, text, replyMarkup);

    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  private async postGetUpdates(url: string, offset?: number): Promise<Response> {
    const body = buildGetUpdatesBody(offset);

    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
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

  private logRequestError(operation: string, url: string, error: unknown): void {
    const cause = error instanceof Error && "cause" in error ? String((error as Error & { cause?: unknown }).cause ?? "") : "";
    this.logger.error("telegram request failed", {
      operation,
      url,
      error: error instanceof Error ? error.message : String(error),
      ...(cause.length > 0 ? { cause } : {})
    });
  }
}
