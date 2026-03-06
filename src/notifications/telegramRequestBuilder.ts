/**
 * Builds Telegram API endpoint URL and request body.
 */
import { RuntimeConfig } from "../config/schema.js";
import { TelegramReplyMarkup } from "../strategies/types.js";

export function buildSendMessageUrl(cfg: RuntimeConfig): string {
  return `${cfg.telegram.apiBaseUrl}/bot${cfg.env.telegramBotToken}/sendMessage`;
}

function toTelegramReplyMarkup(replyMarkup?: TelegramReplyMarkup): Record<string, unknown> | undefined {
  if (!replyMarkup) return undefined;

  return {
    inline_keyboard: replyMarkup.inlineKeyboard.map((row) =>
      row.map((button) => ({
        text: button.text,
        callback_data: button.callbackData
      }))
    )
  };
}

export function buildSendMessageBody(cfg: RuntimeConfig, text: string, replyMarkup?: TelegramReplyMarkup) {
  return {
    chat_id: cfg.env.telegramChatId,
    text,
    parse_mode: cfg.telegram.parseMode,
    disable_web_page_preview: cfg.telegram.disableWebPagePreview,
    reply_markup: toTelegramReplyMarkup(replyMarkup)
  };
}

export function buildEditMessageTextUrl(cfg: RuntimeConfig): string {
  return `${cfg.telegram.apiBaseUrl}/bot${cfg.env.telegramBotToken}/editMessageText`;
}

export function buildEditMessageTextBody(
  cfg: RuntimeConfig,
  messageId: number,
  text: string,
  replyMarkup?: TelegramReplyMarkup
) {
  return {
    chat_id: cfg.env.telegramChatId,
    message_id: messageId,
    text,
    parse_mode: cfg.telegram.parseMode,
    disable_web_page_preview: cfg.telegram.disableWebPagePreview,
    reply_markup: toTelegramReplyMarkup(replyMarkup)
  };
}

export function buildGetUpdatesUrl(cfg: RuntimeConfig): string {
  return `${cfg.telegram.apiBaseUrl}/bot${cfg.env.telegramBotToken}/getUpdates`;
}

export function buildGetUpdatesBody(cfg: RuntimeConfig, offset?: number) {
  return {
    offset,
    timeout: cfg.telegram.getUpdatesLongPollSeconds,
    allowed_updates: ["message", "callback_query"]
  };
}

export function buildAnswerCallbackQueryUrl(cfg: RuntimeConfig): string {
  return `${cfg.telegram.apiBaseUrl}/bot${cfg.env.telegramBotToken}/answerCallbackQuery`;
}

export function buildAnswerCallbackBody(callbackQueryId: string, text?: string) {
  return {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  };
}
