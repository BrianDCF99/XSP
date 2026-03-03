/**
 * Prevents overlapping cycle executions.
 */
export class CycleGate {
  private inFlight = false;

  tryEnter(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  exit(): void {
    this.inFlight = false;
  }
}
