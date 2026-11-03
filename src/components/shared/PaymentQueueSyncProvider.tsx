"use client";
import { doc, getDocFromServer } from "firebase/firestore";
import { usePaymentQueueSync } from "@/hooks/use-payment-queue-sync";
import { replayDeferredEffects } from "@/lib/offline/replayDeferredEffects";
import { updateQueueItem } from "@/lib/offline/payment-queue";
import { decideOfflineReplay } from "@/lib/offline/offlineSyncGate";
import { reconcileQueuedCommand } from "@/lib/offline/reconcileQueuedCommand";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";

export function PaymentQueueSyncProvider() {
  const { user: firebaseUser } = useAuthContext();

  usePaymentQueueSync(async (item) => {
    if (!firebaseUser) return { item, complete: false }; // transient: auth not ready

    // Audit P1: offline commands are settled by the server. Accepted ->
    // done (effects run from the server outbox); rejected -> throw, which
    // marks the item failed and shows it on the OfflineBanner for a manager.
    if (item.opId) {
      return reconcileQueuedCommand(item, {
        getToken: () => firebaseUser.getIdToken(),
        onRejected: () => updateQueueItem(item.id, { rejected: true }),
      });
    }

    // Legacy queue items (recorded by a pre-P1 build that wrote the canonical
    // batch locally). Audit B16/B17: replay deferred effects only after the
    // SERVER confirms the offline batch landed.
    let serverReceipt: Record<string, any> | null = null;
    let serverSession: Record<string, any> | null = null;
    try {
      const [rSnap, sSnap] = await Promise.all([
        item.kind === "void"
          ? Promise.resolve(null)
          : getDocFromServer(doc(db, "stores", item.storeId, "receipts", item.sessionId)),
        getDocFromServer(doc(db, "stores", item.storeId, "sessions", item.sessionId)),
      ]);
      serverReceipt = rSnap && rSnap.exists() ? (rSnap.data() as Record<string, any>) : null;
      serverSession = sSnap.exists() ? (sSnap.data() as Record<string, any>) : null;
    } catch {
      return { item, complete: false }; // transient read failure — retry later
    }

    const decision = decideOfflineReplay(item, serverReceipt, serverSession);
    if (decision.action === "conflict") throw new Error(decision.message);
    if (decision.action === "wait") return { item, complete: false };

    return await replayDeferredEffects(item, {
      getToken: () => firebaseUser.getIdToken(),
      onEffectDone: (updated) => updateQueueItem(updated.id, { effects: updated.effects }),
    });
  }, !!firebaseUser);

  return null;
}
