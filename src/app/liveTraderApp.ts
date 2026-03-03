/**
 * Runtime application wrapper with start/stop lifecycle.
 */
import { RunLoop } from "../core/runLoop.js";

export interface AppLifecycleHooks {
  onBeforeStart?: () => Promise<void>;
  onAfterStart?: () => Promise<void>;
  onBeforeStop?: () => Promise<void>;
}

export class LiveTraderApp {
  constructor(
    private readonly runLoop: RunLoop,
    private readonly hooks: AppLifecycleHooks = {}
  ) {}

  async start(): Promise<void> {
    if (this.hooks.onBeforeStart) {
      await this.hooks.onBeforeStart();
    }
    await this.runLoop.start();
    if (this.hooks.onAfterStart) {
      await this.hooks.onAfterStart();
    }
  }

  async stop(): Promise<void> {
    if (this.hooks.onBeforeStop) {
      await this.hooks.onBeforeStop();
    }
    this.runLoop.stop();
  }
}
