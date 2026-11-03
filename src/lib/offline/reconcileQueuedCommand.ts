import type { QueuedPayment } from "@/lib/offline/payment-queue";

export interface ReconcileDeps {
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
  onRejected?: () => void;
}

/**
 * Submits one queued offline command to /api/pos/commands/reconcile (audit P1
 * / B16). The till's localStorage copy of the command is sent along, so a
 * Firestore create that was denied or never synced cannot lose the sale.
 *
 * - accepted (or already accepted)   -> complete
 * - rejected / dismissed by server   -> throws (item becomes "failed", visible)
 * - network / 5xx / auth not ready   -> incomplete (retried later)
 * Effects are never replayed here: they exist only server-side, written with
 * the accepted receipt, so nothing can run for a sale the server refused.
 */
export async function reconcileQueuedCommand(
  item: QueuedPayment,
  deps: ReconcileDeps,
): Promise<{ item: QueuedPayment; complete: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let token: string;
  try {
    token = await deps.getToken();
  } catch {
    return { item, complete: false };
  }
  let res: Response;
  try {
    res = await fetchImpl("/api/pos/commands/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        storeId: item.storeId,
        opId: item.opId,
        command: item.command,
        // A manual Retry from the banner after a rejection asks the server to
        // re-validate; a plain reconnect never re-runs a rejected command.
        action: item.rejected ? "retry" : "apply",
      }),
    });
  } catch {
    return { item, complete: false };
  }
  const json: any = await res.json().catch(() => ({}));
  if (res.ok && json?.status === "accepted") return { item, complete: true };
  if (res.ok && (json?.status === "rejected" || json?.status === "dismissed")) {
    deps.onRejected?.();
    const what = item.kind === "void" ? "offline void" : `offline sale ${item.receiptNumber ?? ""}`.trim();
    throw new Error(
      json.status === "dismissed"
        ? `The ${what} was closed by a manager: ${json.note || "no note"}.`
        : `The server refused the ${what}: ${json.message || json.code}. A manager must resolve it (refund or re-ring).`,
    );
  }
  if (res.status === 400 || res.status === 403) {
    // Malformed / not this account's command: it can never succeed as sent.
    deps.onRejected?.();
    throw new Error(`The server refused this offline record: ${json?.error || res.status}.`);
  }
  return { item, complete: false };
}
