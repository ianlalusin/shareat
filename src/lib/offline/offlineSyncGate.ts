import type { QueuedPayment } from "@/lib/offline/payment-queue";

/** A doc as read from the SERVER (never the local cache). null = does not exist. */
export type ServerDoc = Record<string, any> | null;

export type SyncGateDecision =
  | { action: "replay" }
  | { action: "wait"; reason: string }
  | { action: "conflict"; message: string };

/**
 * Decides whether an offline sale/void's deferred server effects (loyalty,
 * PINs, analytics) may be replayed yet — audit B17.
 *
 * Replay only once the server copy proves the offline batch was accepted:
 * the session is closed (or voided) on the server and, for a sale, the
 * server receipt is THIS device's offline receipt. Anything that shows another
 * terminal settled the bill is a terminal conflict; anything that merely shows
 * the batch hasn't landed yet means wait. Missing state is never treated as
 * success.
 */
export function decideOfflineReplay(
  item: Pick<QueuedPayment, "kind" | "sessionId" | "receiptNumber" | "offlineWriteId">,
  serverReceipt: ServerDoc,
  serverSession: ServerDoc,
): SyncGateDecision {
  const short = item.sessionId.slice(0, 6);
  const sessionStatus = serverSession?.status ?? null;

  if (item.kind === "void") {
    if (sessionStatus === "voided") return { action: "replay" };
    if (sessionStatus === "closed" || serverSession?.isPaid === true) {
      return { action: "conflict", message: `Session ${short}… was paid on the server; the offline void was not applied.` };
    }
    return { action: "wait", reason: "void not yet on server" };
  }

  if (serverReceipt) {
    if (serverReceipt.status === "final" && serverReceipt.offlineOrigin !== true) {
      return { action: "conflict", message: `Server already has an online receipt for session ${item.sessionId}; offline effects skipped (conflict).` };
    }
    if (
      serverReceipt.offlineOrigin === true &&
      item.receiptNumber &&
      serverReceipt.receiptNumber !== item.receiptNumber
    ) {
      return { action: "conflict", message: `Session ${short}… was settled offline on another terminal (receipt ${serverReceipt.receiptNumber}); this device's sale ${item.receiptNumber} was not applied.` };
    }
  }

  if (
    item.offlineWriteId &&
    serverSession?.offlineWriteId &&
    serverSession.offlineWriteId !== item.offlineWriteId
  ) {
    return { action: "conflict", message: `Session ${short}… was closed by a different offline write; this device's sale was not applied.` };
  }

  if (!serverReceipt) {
    if (sessionStatus === "closed" || sessionStatus === "voided") {
      return { action: "conflict", message: `Session ${short}… was ${sessionStatus} on the server without this offline receipt; the sale was not applied.` };
    }
    return { action: "wait", reason: "receipt not yet on server" };
  }

  if (sessionStatus !== "closed") return { action: "wait", reason: "session not yet closed on server" };
  return { action: "replay" };
}
