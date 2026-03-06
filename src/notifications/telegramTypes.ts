/**
 * Telegram API response contracts.
 */
export interface TelegramApiResponse {
  ok: boolean;
  result?:
    | {
        message_id: number;
      }
    | boolean;
  description?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  chat: TelegramChat;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramUpdatesApiResponse {
  ok: boolean;
  result?: TelegramUpdate[];
  description?: string;
}
