/**
 * Builds Telegram API endpoint URL and request body.
 */
import { RuntimeConfig } from "../config/schema.js";
import { TelegramReplyMarkup } from "../strategies/types.js";

export function buildSendMessageUrl(cfg: RuntimeConfig): string {
  return `https://api.telegram.org/bot${cfg.env.telegramBotToken}/sendMessage`;
}

export function buildSendMessageBody(cfg: RuntimeConfig, text: string, replyMarkup?: TelegramReplyMarkup) {
  const body: Record<string, unknown> = {
    chat_id: cfg.env.telegramChatId,
    text,
    parse_mode: cfg.telegram.parseMode,
    disable_web_page_preview: cfg.telegram.disableWebPagePreview
  };

  if (replyMarkup) {
    body.reply_markup = {
      inline_keyboard: replyMarkup.inlineKeyboard.map((row) =>
        row.map((button) => ({
          text: button.text,
          callback_data: button.callbackData
        }))
      )
    };
  }

  return body;
}

export function buildGetUpdatesUrl(cfg: RuntimeConfig): string {
  return `https://api.telegram.org/bot${cfg.env.telegramBotToken}/getUpdates`;
}

export function buildGetUpdatesBody(offset?: number) {
  return {
    offset,
    timeout: 0,
    allowed_updates: ["message", "callback_query"]
  };
}

export function buildAnswerCallbackQueryUrl(cfg: RuntimeConfig): string {
  return `https://api.telegram.org/bot${cfg.env.telegramBotToken}/answerCallbackQuery`;
}

export function buildAnswerCallbackBody(callbackQueryId: string, text?: string) {
  return {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  };
}
