/**
 * Persists and dispatches messages/events for manual-action workflows.
 */
import { Repositories } from "../../db/repos/index.js";
import { ExchangeAccountState } from "../../exchange/accountStateExtractor.js";
import { MessageDispatcher } from "../../notifications/messageDispatcher.js";
import { PositionEvent, StrategyMessage } from "../../strategies/types.js";
import { Logger } from "../../utils/logger.js";
import { captureStrategyAccountSnapshot } from "../account/captureStrategyAccountSnapshot.js";
import { ManualAlertService } from "./manualAlertService.js";
import { asNumber, nowIso } from "./manualActionShared.js";

interface ManualActionPublisherDeps {
  repos: Repositories;
  messageDispatcher: MessageDispatcher;
  manualAlertService: ManualAlertService;
  logger: Logger;
  fetchLiveExchangeAccountState: () => Promise<ExchangeAccountState | null>;
  strictLiveAccount: boolean;
}

export class ManualActionPublisher {
  constructor(private readonly deps: ManualActionPublisherDeps) {}

  async publish(
    strategyName: string,
    messages: StrategyMessage[],
    events: PositionEvent[],
    exchangeRunLabel: string
  ): Promise<void> {
    const runId = await this.deps.repos.runs.create(exchangeRunLabel);
    const strategyRunId = await this.deps.repos.strategies.startRun(runId, strategyName);

    try {
      const prepared = await this.deps.manualAlertService.prepareForDispatch(runId, strategyName, messages);
      const delivered = await this.deps.messageDispatcher.dispatch(prepared);
      await this.deps.manualAlertService.applyDelivery(delivered);

      await this.deps.repos.strategies.insertMessages(runId, strategyRunId, strategyName, delivered);
      await this.deps.repos.trades.insertPositionEvents(runId, events);
      await this.deps.repos.trades.applyPositionState(events);

      let liveAccount:
        | {
            equityUsd: number;
            cashUsd: number;
            marginInUseUsd: number;
            openNotionalUsd: number;
            unrealizedPnlUsd: number;
          }
        | null = null;

      try {
        const fetched = await this.deps.fetchLiveExchangeAccountState();
        if (!fetched && this.deps.strictLiveAccount) {
          throw new Error("Strict live account mode requires exchange account payload");
        }

        if (fetched) {
          const resolved = {
            equityUsd: asNumber(fetched.equityUsd, Number.NaN),
            cashUsd: asNumber(fetched.cashUsd, Number.NaN),
            marginInUseUsd: asNumber(fetched.marginInUseUsd, Number.NaN),
            openNotionalUsd: asNumber(fetched.openNotionalUsd, Number.NaN),
            unrealizedPnlUsd: asNumber(fetched.unrealizedPnlUsd, Number.NaN)
          };

          if (
            this.deps.strictLiveAccount &&
            (!Number.isFinite(resolved.equityUsd) ||
              !Number.isFinite(resolved.cashUsd) ||
              !Number.isFinite(resolved.marginInUseUsd) ||
              !Number.isFinite(resolved.openNotionalUsd) ||
              !Number.isFinite(resolved.unrealizedPnlUsd))
          ) {
            throw new Error("Strict live account mode requires equity/cash/margin/notional/unrealized from exchange");
          }

          if (this.deps.strictLiveAccount) {
            liveAccount = {
              equityUsd: resolved.equityUsd,
              cashUsd: resolved.cashUsd,
              marginInUseUsd: resolved.marginInUseUsd,
              openNotionalUsd: resolved.openNotionalUsd,
              unrealizedPnlUsd: resolved.unrealizedPnlUsd
            };
          } else {
            liveAccount = {
              equityUsd: Number.isFinite(resolved.equityUsd) ? resolved.equityUsd : 0,
              cashUsd: Number.isFinite(resolved.cashUsd) ? resolved.cashUsd : 0,
              marginInUseUsd: Number.isFinite(resolved.marginInUseUsd) ? resolved.marginInUseUsd : 0,
              openNotionalUsd: Number.isFinite(resolved.openNotionalUsd) ? resolved.openNotionalUsd : 0,
              unrealizedPnlUsd: Number.isFinite(resolved.unrealizedPnlUsd) ? resolved.unrealizedPnlUsd : 0
            };
          }
        }
      } catch (error) {
        if (this.deps.strictLiveAccount) {
          throw error;
        }

        this.deps.logger.warn("snapshot capture using derived account fallback", {
          strategy: strategyName,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      await captureStrategyAccountSnapshot({
        repos: this.deps.repos,
        strategyName,
        observedAt: nowIso(),
        liveAccount,
        strictLiveAccount: this.deps.strictLiveAccount
      });

      await this.deps.repos.strategies.finishRun(strategyRunId, "SUCCESS");
      await this.deps.repos.runs.finish(runId, "SUCCESS");
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      await this.deps.repos.strategies.finishRun(strategyRunId, "FAILED", errorText);
      await this.deps.repos.runs.finish(runId, "FAILED", errorText);
      throw error;
    }
  }
}
