/**
 * Creates persistent action-alert records and attaches inline keyboards to messages.
 */
import { ManualAlertCreateInput } from "../../db/repos/manualAlertRepository.js";
import { Repositories } from "../../db/repos/index.js";
import { DeliveredMessage } from "../../notifications/messageDispatcher.js";
import {
  ManualAlertButtonAction,
  StrategyMessage,
  TelegramInlineButton,
  TelegramReplyMarkup
} from "../../strategies/types.js";
import { encodeCallbackData } from "./callbackDataCodec.js";

function buttonLabel(action: ManualAlertButtonAction): string {
  if (action === "OPENED") return "Opened";
  if (action === "CLOSED") return "Closed";
  if (action === "REFRESH") return "Refresh";
  if (action === "TRACK") return "Track";
  return "Do Not Track";
}

function toInlineButton(alertId: string, action: ManualAlertButtonAction): TelegramInlineButton {
  return {
    text: buttonLabel(action),
    callbackData: encodeCallbackData(alertId, action)
  };
}

function toReplyMarkup(alertId: string, actions: ManualAlertButtonAction[]): TelegramReplyMarkup {
  return {
    inlineKeyboard: [actions.map((action) => toInlineButton(alertId, action))]
  };
}

export class ManualAlertService {
  constructor(private readonly repos: Repositories) {}

  async prepareForDispatch(cycleRunId: string, strategyName: string, messages: StrategyMessage[]): Promise<StrategyMessage[]> {
    const prepared: StrategyMessage[] = [];

    for (const message of messages) {
      if (!message.manualAlert) {
        prepared.push(message);
        continue;
      }

      const alertInput: ManualAlertCreateInput = {
        cycleRunId,
        strategyName,
        kind: message.manualAlert.kind,
        primarySymbol: message.manualAlert.primarySymbol,
        payload: message.manualAlert.payload
      };

      if (typeof message.manualAlert.secondarySymbol === "string" && message.manualAlert.secondarySymbol.length > 0) {
        alertInput.secondarySymbol = message.manualAlert.secondarySymbol;
      }

      if (typeof message.manualAlert.reason === "string" && message.manualAlert.reason.length > 0) {
        alertInput.reason = message.manualAlert.reason;
      }

      const alertId = await this.repos.manualAlerts.create(alertInput);

      prepared.push({
        ...message,
        manualAlertId: alertId,
        replyMarkup: toReplyMarkup(alertId, message.manualAlert.buttons)
      });
    }

    return prepared;
  }

  async applyDelivery(records: DeliveredMessage[]): Promise<void> {
    for (const record of records) {
      const alertId = record.message.manualAlertId;
      if (!alertId) continue;
      await this.repos.manualAlerts.setTelegramMessageId(alertId, record.telegramMessageId);
    }
  }
}
