/**
 * Process entrypoint.
 */
import { createApp } from "./app/createApp.js";

async function main(): Promise<void> {
  const app = createApp();
  await app.start();

  const shutdown = async (signal: string) => {
    await app.stop();
    console.log(`${new Date().toISOString()} [INFO] shutdown signal ${signal}`);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} [ERROR] fatal`, error);
  process.exit(1);
});
