/**
 * Sends strategy messages to Telegram when requested.
 */
import { StrategyMessage } from "../strategies/types.js";
import { TelegramClient } from "./telegramClient.js";

export interface DeliveredMessage {
  message: StrategyMessage;
  telegramMessageId: number | null;
}

function normalizeSymbol(symbol: string | undefined): string {
  if (typeof symbol !== "string") return "";
  return symbol.trim().toUpperCase();
}

function isEntryLikeManualAlert(message: StrategyMessage): boolean {
  const manualAlert = message.manualAlert;
  if (!manualAlert) return false;

  const kind = manualAlert.kind;
  if (kind !== "ENTRY_AVAILABLE" && kind !== "REPLACEMENT_AVAILABLE") return false;
  return normalizeSymbol(manualAlert.primarySymbol).length > 0;
}

function entryLikeSymbol(message: StrategyMessage): string {
  const manualAlert = message.manualAlert;
  if (!manualAlert) return "";
  const kind = manualAlert.kind;
  if (kind !== "ENTRY_AVAILABLE" && kind !== "REPLACEMENT_AVAILABLE") return "";
  return normalizeSymbol(manualAlert.primarySymbol);
}

function isEditableEntryLikeBatch(messages: StrategyMessage[]): boolean {
  const sendableMessages = messages.filter((message) => (message.sendTelegram ?? true) === true);
  if (sendableMessages.length === 0) return false;

  const seen = new Set<string>();
  for (const message of sendableMessages) {
    if (!isEntryLikeManualAlert(message)) return false;
    const symbol = entryLikeSymbol(message);
    if (symbol.length === 0 || seen.has(symbol)) return false;
    seen.add(symbol);
  }

  return true;
}

function orderForDispatch(messages: StrategyMessage[]): StrategyMessage[] {
  const entryLike: StrategyMessage[] = [];
  const rest: StrategyMessage[] = [];

  for (const message of messages) {
    if (isEntryLikeManualAlert(message)) {
      entryLike.push(message);
    } else {
      rest.push(message);
    }
  }

  return [...entryLike, ...rest];
}

export class MessageDispatcher {
  constructor(private readonly telegram: TelegramClient) {}

  async dispatch(messages: StrategyMessage[]): Promise<DeliveredMessage[]> {
    const records: DeliveredMessage[] = [];
    const ordered = orderForDispatch(messages);
    const useEntryLikeUpsert = isEditableEntryLikeBatch(ordered);
    this.telegram.setOpportunityUpsertMode(useEntryLikeUpsert);

    for (const message of ordered) {
      const shouldSend = message.sendTelegram ?? true;
      let telegramMessageId: number | null = null;

      if (shouldSend) {
        if (useEntryLikeUpsert && isEntryLikeManualAlert(message)) {
          const symbol = entryLikeSymbol(message);
          telegramMessageId = await this.telegram.upsertOpportunityMessage(symbol, message.text, message.replyMarkup);
        } else {
          telegramMessageId = await this.telegram.sendMessage(message.text, message.replyMarkup);
        }
      }

      records.push({ message, telegramMessageId });
    }

    return records;
  }
}
