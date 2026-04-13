
"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useStoreContext } from "@/context/store-context";
import { StartShiftModal } from "@/components/shared/StartShiftModal";

const SessionDetailView = dynamic(
  () => import('@/components/cashier/session-detail-view').then((mod) => mod.SessionDetailView),
  {
    loading: () => <div className="flex items-center justify-center h-screen"><Loader2 className="h-10 w-10 animate-spin" /></div>,
    ssr: false,
  }
);

const SessionListView = dynamic(
  () => import('@/components/cashier/session-list-view').then((mod) => mod.SessionListView),
  {
    loading: () => <div className="flex items-center justify-center h-screen"><Loader2 className="h-10 w-10 animate-spin" /></div>,
    ssr: false,
  }
);

/**
 * Returns shift day ID (YYYY-MM-DD) anchored at 4 AM Asia/Manila.
 * Before 4 AM rolls back to the previous calendar day.
 */
function getShiftDayId(): string {
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  if (manila.getHours() < 4) manila.setDate(manila.getDate() - 1);
  const y = manila.getFullYear();
  const m = String(manila.getMonth() + 1).padStart(2, "0");
  const d = String(manila.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const LAST_SHIFT_KEY = "startShiftLastShown";

function CashierPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('sessionId') ?? null;
  const { activeStore } = useStoreContext();
  const [shiftOpen, setShiftOpen] = useState(false);

  useEffect(() => {
    if (!activeStore?.id) return;
    const shiftId = getShiftDayId();
    try {
      const last = localStorage.getItem(LAST_SHIFT_KEY);
      if (last !== shiftId) setShiftOpen(true);
    } catch {
      setShiftOpen(true);
    }
  }, [activeStore?.id]);

  function handleShiftAnswered() {
    try {
      localStorage.setItem(LAST_SHIFT_KEY, getShiftDayId());
    } catch {}
    setShiftOpen(false);
  }

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      {sessionId ? <SessionDetailView sessionId={sessionId} /> : <SessionListView />}
      {activeStore?.id && (
        <StartShiftModal
          isOpen={shiftOpen}
          onClose={handleShiftAnswered}
          storeId={activeStore.id}
        />
      )}
    </RoleGuard>
  );
}


export default function CashierPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
      <CashierPageContent />
    </Suspense>
  )
}
