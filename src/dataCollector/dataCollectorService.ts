/**
 * Schedules and runs the market-data archive worker independently from the main cycle.
 */
import { RuntimeConfig } from "../config/schema.js";
import { resolveActiveExchange } from "../exchange/exchangeConfigResolver.js";
import { Logger } from "../utils/logger.js";
import { computeNextTickMs } from "../utils/time.js";
import { runCollectorWorker } from "./thread/collectorWorkerRunner.js";
import { CollectorWorkerInput } from "./types.js";

const DEFAULT_WORKER_TIMEOUT_MS = 55 * 60_000;

function buildRunId(exchangeName: string): string {
  const iso = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `${exchangeName}:archive:${iso}`;
}

export class DataCollectorService {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private running = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly cfg: RuntimeConfig,
    private readonly logger: Logger
  ) {}

  async start(): Promise<void> {
    if (!this.cfg.dataCollector.enabled) {
      this.logger.info("data collector disabled");
      return;
    }

    this.stopped = false;

    if (this.cfg.dataCollector.immediateRunOnBoot) {
      this.inFlight = this.safeRun("boot").finally(() => {
        this.inFlight = null;
      });
    }

    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlight) {
      this.logger.warn("data collector stop requested while run is in-flight", {
        action: "allow_current_run_to_finish"
      });
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;

    const nowMs = Date.now();
    const nextMs = computeNextTickMs(nowMs, this.cfg.dataCollector.cadence);
    const waitMs = Math.max(0, nextMs - nowMs);

    this.logger.info("next archive collection scheduled", {
      runAt: new Date(nextMs).toISOString(),
      waitMs
    });

    this.timer = setTimeout(() => {
      this.inFlight = this.safeRun("scheduled").finally(() => {
        this.inFlight = null;
        this.scheduleNext();
      });
    }, waitMs);
  }

  private async safeRun(trigger: "boot" | "scheduled"): Promise<void> {
    if (this.running) {
      this.logger.warn("archive collection skipped", { reason: "already_running", trigger });
      return;
    }

    const exchange = resolveActiveExchange(this.cfg);
    const archiveEndpoints = exchange.archiveEndpoints.filter((endpoint) => endpoint.enabled);
    if (archiveEndpoints.length === 0) {
      this.logger.warn("archive collection skipped", {
        reason: "no_enabled_archive_endpoints",
        exchange: exchange.name,
        trigger
      });
      return;
    }

    this.running = true;

    const workerInput: CollectorWorkerInput = {
      runId: buildRunId(exchange.name),
      exchangeName: exchange.name,
      restBaseUrl: exchange.restBaseUrl,
      requestTimeoutMs: this.cfg.exchange.requestTimeoutMs,
      maxParallelRequests: this.cfg.dataCollector.maxParallelRequests,
      lookbackMinutes: this.cfg.dataCollector.lookbackMinutes,
      outputDir: this.cfg.dataCollector.outputDir,
      stateFile: this.cfg.dataCollector.stateFile,
      endpoints: archiveEndpoints,
      nowMs: Date.now()
    };

    try {
      const summary = await runCollectorWorker(
        workerInput,
        this.cfg.dataCollector.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS
      );
      this.logger.info("archive collection completed", { ...summary });
    } catch (error) {
      this.logger.error("archive collection failed", {
        trigger,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.running = false;
    }
  }
}
