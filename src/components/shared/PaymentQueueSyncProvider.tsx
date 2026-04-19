"use client";
import { useMemo } from "react";
import { doc, getDoc } from "firebase/firestore";
import { usePaymentQueueSync } from "@/hooks/use-payment-queue-sync";
import { completePaymentFromUnits } from "@/components/cashier/firestore";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";
import { db } from "@/lib/firebase/client";
import type { ModeOfPayment, Store } from "@/lib/types";

async function loadQueuedStoreContext(
  storeId: string,
  activeStore: Store | null,
  activePaymentMethods: ModeOfPayment[]
): Promise<{ store: Store; paymentMethods: ModeOfPayment[] }> {
  if (activeStore?.id === storeId) {
    return { store: activeStore, paymentMethods: activePaymentMethods };
  }

  const [storeSnap, configSnap] = await Promise.all([
    getDoc(doc(db, "stores", storeId)),
    getDoc(doc(db, "stores", storeId, "storeConfig", "current")),
  ]);

  if (!storeSnap.exists()) {
    throw new Error(`Queued payment store ${storeId} was not found.`);
  }

  const config = configSnap.exists() ? configSnap.data() : null;
  const paymentMethods = Array.isArray(config?.modesOfPayment)
    ? config.modesOfPayment.filter((m: ModeOfPayment) => m.isActive && !(m as any).isArchived)
    : [];

  return {
    store: { id: storeSnap.id, ...storeSnap.data() } as Store,
    paymentMethods,
  };
}

export function PaymentQueueSyncProvider() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { config: storeConfig } = useStoreConfigDoc(activeStore?.id);

  const activePaymentMethods = useMemo(() => {
    if (!storeConfig?.modesOfPayment) return [];
    return storeConfig.modesOfPayment.filter(m => m.isActive && !(m as any).isArchived);
  }, [storeConfig]);

  usePaymentQueueSync(async (_queuedId, storeId, sessionId, payload) => {
    if (!appUser) throw new Error("Not authenticated");
    const { store, paymentMethods } = await loadQueuedStoreContext(
      storeId,
      activeStore,
      activePaymentMethods,
    );

    return await completePaymentFromUnits(
      storeId,
      sessionId,
      appUser,
      payload.payments,
      store,
      paymentMethods,
      payload.totalAmount,
    );
  });

  return null;
}
