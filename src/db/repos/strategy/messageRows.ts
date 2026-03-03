/**
 * Maps strategy messages into database row payloads.
 */
import type { StrategyMessageWithDelivery } from "../strategyRepository.js";

export function mapMessageRows(
  cycleRunId: string,
  strategyRunId: string,
  strategyName: string,
  records: StrategyMessageWithDelivery[]
) {
  return records.map(({ message, telegramMessageId }) => ({
    cycle_run_id: cycleRunId,
    strategy_run_id: strategyRunId,
    strategy_name: strategyName,
    message_type: message.type,
    symbol: message.symbol ?? null,
    body: message.text,
    telegram_message_id: telegramMessageId,
    manual_alert_id: message.manualAlertId ?? null
  }));
}
