
"use client";

import { Suspense } from 'react';
import { useSearchParams } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2 } from 'lucide-react';
import dynamic from 'next/dynamic';

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


function CashierPageContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams?.get('sessionId') ?? null;

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
