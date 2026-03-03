/**
 * Sends strategy messages to Telegram when requested.
 */
import { StrategyMessage } from "../strategies/types.js";
import { TelegramClient } from "./telegramClient.js";

export interface DeliveredMessage {
  message: StrategyMessage;
  telegramMessageId: number | null;
}

export class MessageDispatcher {
  constructor(private readonly telegram: TelegramClient) {}

  async dispatch(messages: StrategyMessage[]): Promise<DeliveredMessage[]> {
    const records: DeliveredMessage[] = [];

    for (const message of messages) {
      const shouldSend = message.sendTelegram ?? true;
      const telegramMessageId = shouldSend ? await this.telegram.sendMessage(message.text, message.replyMarkup) : null;
      records.push({ message, telegramMessageId });
    }

    return records;
  }
}
