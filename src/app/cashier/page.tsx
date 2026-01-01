
"use client";

import { Suspense } from 'react';
import { useSearchParams } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { SessionDetailView } from "@/components/cashier/session-detail-view";
import { SessionListView } from "@/components/cashier/session-list-view";
import { Loader2 } from 'lucide-react';

function CashierPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('sessionId');

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      {sessionId ? <SessionDetailView sessionId={sessionId} /> : <SessionListView />}
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
