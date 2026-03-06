/**
 * Small response helpers for Telegram API payloads.
 */
import { TelegramApiResponse, TelegramUpdatesApiResponse } from "./telegramTypes.js";

export function extractTelegramMessageId(data: TelegramApiResponse): number | null {
  if (!data.result || typeof data.result === "boolean") return null;
  return data.result.message_id ?? null;
}

export function isTelegramSendSuccess(httpOk: boolean, data: TelegramApiResponse): boolean {
  return httpOk && data.ok;
}

export function isTelegramUpdatesSuccess(httpOk: boolean, data: TelegramUpdatesApiResponse): boolean {
  return httpOk && data.ok && Array.isArray(data.result);
}
