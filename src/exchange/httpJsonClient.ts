/**
 * Minimal HTTP client for exchange endpoints.
 */
export interface HttpResult {
  ok: boolean;
  statusCode: number;
  latencyMs: number;
  payload: unknown;
  error: string | null;
}

function parsePayload(contentType: string | null, bodyText: string): unknown {
  if (!bodyText) return null;
  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return bodyText;
    }
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export class HttpJsonClient {
  constructor(private readonly timeoutMs: number) {}

  async request(method: "GET" | "POST", url: string): Promise<HttpResult> {
    const startedMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "user-agent": "LiveTrader/0.1"
        }
      });

      const bodyText = await res.text();
      const payload = parsePayload(res.headers.get("content-type"), bodyText);

      return {
        ok: res.ok,
        statusCode: res.status,
        latencyMs: Date.now() - startedMs,
        payload,
        error: null
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        latencyMs: Date.now() - startedMs,
        payload: null,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
