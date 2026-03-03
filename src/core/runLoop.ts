/**
 * Clock loop that triggers cycle execution on configured cadence + offset.
 */
import { RuntimeConfig } from "../config/schema.js";
import { Logger } from "../utils/logger.js";
import { computeNextTickMs } from "../utils/time.js";

export class RunLoop {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger,
    private readonly onTick: () => Promise<void>
  ) {}

  async start(): Promise<void> {
    this.stopped = false;

    if (this.cfg.scheduler.immediateRunOnBoot) {
      await this.safeTick("boot");
    }

    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;

    const nowMs = Date.now();
    const nextMs = computeNextTickMs(nowMs, this.cfg.scheduler.cadence);
    const waitMs = Math.max(0, nextMs - nowMs);

    this.logger.info("next cycle scheduled", {
      runAt: new Date(nextMs).toISOString(),
      waitMs
    });

    this.timer = setTimeout(() => {
      void this.safeTick("scheduled").finally(() => this.scheduleNext());
    }, waitMs);
  }

  private async safeTick(trigger: "boot" | "scheduled"): Promise<void> {
    try {
      this.logger.info("cycle tick", { trigger });
      await this.onTick();
    } catch (error) {
      this.logger.error("cycle tick failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
