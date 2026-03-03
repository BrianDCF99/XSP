/**
 * Maps event type to terminal position status.
 */
import { PositionEvent } from "../../../strategies/types.js";

export function toClosedStatus(eventType: PositionEvent["type"]): "CLOSED" | "LIQUIDATED" | "REPLACED" {
  if (eventType === "LIQUIDATION") return "LIQUIDATED";
  if (eventType === "REPLACE") return "REPLACED";
  return "CLOSED";
}
