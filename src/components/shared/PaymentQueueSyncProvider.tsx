"use client";
import { useMemo } from "react";
import { usePaymentQueueSync } from "@/hooks/use-payment-queue-sync";
import { completePaymentFromUnits } from "@/components/cashier/firestore";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";

export function PaymentQueueSyncProvider() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { config: storeConfig } = useStoreConfigDoc(activeStore?.id);

  const paymentMethods = useMemo(() => {
    if (!storeConfig?.modesOfPayment) return [];
    return storeConfig.modesOfPayment.filter(m => m.isActive && !(m as any).isArchived);
  }, [storeConfig]);

  usePaymentQueueSync(async (_queuedId, storeId, sessionId, payload) => {
    if (!appUser) throw new Error("Not authenticated");
    if (!activeStore) throw new Error("No active store");
    return await completePaymentFromUnits(
      storeId,
      sessionId,
      appUser,
      payload.payments,
      activeStore,
      paymentMethods,
      payload.totalAmount,
    );
  });

  return null;
}
