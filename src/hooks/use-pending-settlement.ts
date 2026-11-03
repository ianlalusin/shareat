"use client";

import { useEffect, useState } from "react";
import { QUEUE_EVENT, getQueue, pendingSettlementSessionIds } from "@/lib/offline/payment-queue";

/**
 * Session ids paid or voided offline on this till whose command the server has
 * not accepted yet (audit P1). The cashier list hides these bills and offers
 * their tables for re-seating; nothing canonical was written locally, so this
 * overlay is what keeps the offline UI usable. Rejected commands drop out of
 * the set, so the bill reappears for the cashier to resolve.
 */
export function usePendingSettlement(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      try {
        setIds(pendingSettlementSessionIds(getQueue()));
      } catch {
        setIds(new Set());
      }
    };
    refresh();
    window.addEventListener(QUEUE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(QUEUE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return ids;
}
