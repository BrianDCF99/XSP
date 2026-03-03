/**
 * Encodes/decodes compact callback data for telegram inline buttons.
 */
import { ManualAlertButtonAction } from "../../strategies/types.js";

const PREFIX = "lta";

function encodeAction(action: ManualAlertButtonAction): string {
  if (action === "OPENED") return "o";
  if (action === "CLOSED") return "c";
  if (action === "REFRESH") return "r";
  if (action === "TRACK") return "t";
  return "i";
}

function decodeAction(raw: string): ManualAlertButtonAction | null {
  if (raw === "o") return "OPENED";
  if (raw === "c") return "CLOSED";
  if (raw === "r") return "REFRESH";
  if (raw === "t") return "TRACK";
  if (raw === "i") return "IGNORE";
  return null;
}

export function encodeCallbackData(alertId: string, action: ManualAlertButtonAction): string {
  return `${PREFIX}|${encodeAction(action)}|${alertId}`;
}

export function decodeCallbackData(data: string): { alertId: string; action: ManualAlertButtonAction } | null {
  const parts = data.split("|");
  if (parts.length !== 3) return null;
  if (parts[0] !== PREFIX) return null;

  const rawAction = parts[1];
  if (typeof rawAction !== "string") return null;

  const action = decodeAction(rawAction);
  if (!action) return null;

  const alertId = parts[2];
  if (!alertId || alertId.length < 8) return null;

  return {
    alertId,
    action
  };
}
