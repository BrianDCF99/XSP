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

    try {
      const res = await this.postMessage(text, replyMarkup);
      const data = (await res.json()) as TelegramApiResponse;

      if (!isTelegramSendSuccess(res.ok, data)) {
        this.logFailure(res.status, data.description ?? "unknown");
        return null;
      }

      return extractTelegramMessageId(data);
    } catch (error) {
      this.logRequestError(error);
      return null;
    }
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    if (!this.isEnabled()) return [];

    try {
      const res = await this.postGetUpdates(offset);
      const data = (await res.json()) as TelegramUpdatesApiResponse;

      if (!isTelegramUpdatesSuccess(res.ok, data)) {
        this.logFailure(res.status, data.description ?? "unknown");
        return [];
      }

      return data.result ?? [];
    } catch (error) {
      this.logRequestError(error);
      return [];
    }
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const url = buildAnswerCallbackQueryUrl(this.cfg);
      const body = buildAnswerCallbackBody(callbackQueryId, text);

      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (error) {
      this.logRequestError(error);
    }
  }

  private async postMessage(text: string, replyMarkup?: TelegramReplyMarkup): Promise<Response> {
    const url = buildSendMessageUrl(this.cfg);
    const body = buildSendMessageBody(this.cfg, text, replyMarkup);

    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  private async postGetUpdates(offset?: number): Promise<Response> {
    const url = buildGetUpdatesUrl(this.cfg);
    const body = buildGetUpdatesBody(offset);

    return fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  private logFailure(status: number, description: string): void {
    this.logger.warn("telegram send failed", {
      status,
      description
    });
  }

  private logRequestError(error: unknown): void {
    this.logger.error("telegram request failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
