"use client";
import { doc, getDoc } from "firebase/firestore";
import { usePaymentQueueSync } from "@/hooks/use-payment-queue-sync";
import { replayDeferredEffects } from "@/lib/offline/replayDeferredEffects";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";

export function PaymentQueueSyncProvider() {
  const { user: firebaseUser } = useAuthContext();

  usePaymentQueueSync(async (item) => {
    if (!firebaseUser) throw new Error("Not authenticated");

    // Guardrail 5a: if the server already holds a NON-offline final receipt for
    // this session, an online sale beat us — do not apply offline effects on top.
    const receiptSnap = await getDoc(doc(db, "stores", item.storeId, "receipts", item.sessionId));
    if (receiptSnap.exists()) {
      const r: any = receiptSnap.data();
      if (r.status === "final" && r.offlineOrigin !== true) {
        throw new Error(`Server already has an online receipt for session ${item.sessionId}; offline effects skipped (conflict).`);
      }
    }

    return await replayDeferredEffects(item, { getToken: () => firebaseUser.getIdToken() });
  });

  return null;
}
