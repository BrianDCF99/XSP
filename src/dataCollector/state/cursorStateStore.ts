/**
 * Persistent cursor store for deduping archive records across runs.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { CollectorCursorState } from "../types.js";

interface CursorFilePayload {
  cursors?: Record<string, unknown>;
}

export class CursorStateStore {
  private readonly absoluteFilePath: string;

  constructor(filePath: string) {
    this.absoluteFilePath = path.resolve(process.cwd(), filePath);
  }

  get filePath(): string {
    return this.absoluteFilePath;
  }

  async load(): Promise<Map<string, number>> {
    try {
      const raw = await fs.readFile(this.absoluteFilePath, "utf8");
      const parsed = JSON.parse(raw) as CursorFilePayload;
      const map = new Map<string, number>();

      for (const [key, value] of Object.entries(parsed.cursors ?? {})) {
        const minuteMs = Number(value);
        if (Number.isFinite(minuteMs) && minuteMs > 0) {
          map.set(key, minuteMs);
        }
      }

      return map;
    } catch {
      return new Map<string, number>();
    }
  }

  async save(cursors: Map<string, number>): Promise<void> {
    const payload: CollectorCursorState = {
      cursors: Object.fromEntries(cursors.entries())
    };

    const targetDir = path.dirname(this.absoluteFilePath);
    await fs.mkdir(targetDir, { recursive: true });

    const tmpPath = `${this.absoluteFilePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload), "utf8");
    await fs.rename(tmpPath, this.absoluteFilePath);
  }
}
