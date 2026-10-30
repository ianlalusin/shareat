import type { SessionBillLine } from "@/lib/types";

/**
 * F24: in the live session view the Firestore snapshot is the only source of
 * committed bill lines. The post-commit "added line" callback must never
 * increment a row the snapshot already reflects. If the line's ID is already
 * present we leave state alone; otherwise we show it as a temporary overlay
 * that the next snapshot replaces wholesale.
 */
export function overlayAddedLine(current: SessionBillLine[], added: SessionBillLine): SessionBillLine[] {
  if (current.some((l) => l.id === added.id)) return current;
  return [...current, added];
}

/**
 * Receipt editor (no live snapshot — local state IS the source). Merge by the
 * actual bill-line ID so modifier variants of the same product/base price stay
 * separate lines.
 */
export function mergeLocalAddedLine(current: SessionBillLine[], added: SessionBillLine): SessionBillLine[] {
  const idx = current.findIndex((l) => l.id === added.id);
  if (idx < 0) return [...current, added];
  const next = [...current];
  next[idx] = { ...next[idx], qtyOrdered: (next[idx].qtyOrdered ?? 0) + (added.qtyOrdered ?? 0) };
  return next;
}
