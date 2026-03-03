/**
 * Appends normalized archive records to per-symbol NDJSON files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { SymbolArchiveRecord } from "../types.js";

function sanitizeSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_");
}

export class SymbolArchiveWriter {
  private readonly absoluteOutputDir: string;

  constructor(outputDir: string) {
    this.absoluteOutputDir = path.resolve(process.cwd(), outputDir);
  }

  get outputDir(): string {
    return this.absoluteOutputDir;
  }

  async append(record: SymbolArchiveRecord): Promise<void> {
    const symbol = sanitizeSymbol(record.symbol);
    if (symbol.length === 0) return;

    const filePath = path.join(this.absoluteOutputDir, `${symbol}.ndjson`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const payload = `${JSON.stringify(record)}\n`;
    await fs.appendFile(filePath, payload, "utf8");
  }
}
