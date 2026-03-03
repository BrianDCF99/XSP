/**
 * Small console logger wrapper with stable structured output.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

function formatLine(level: string, message: string, meta?: Record<string, unknown>): string {
  const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${new Date().toISOString()} [${level}] ${message}${payload}`;
}

export function createLogger(debugEnabled = false): Logger {
  return {
    info(message, meta) {
      console.log(formatLine("INFO", message, meta));
    },
    warn(message, meta) {
      console.warn(formatLine("WARN", message, meta));
    },
    error(message, meta) {
      console.error(formatLine("ERROR", message, meta));
    },
    debug(message, meta) {
      if (!debugEnabled) return;
      console.debug(formatLine("DEBUG", message, meta));
    }
  };
}
