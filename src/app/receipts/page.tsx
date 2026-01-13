
"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import dynamic from 'next/dynamic';

const ReceiptsPageContents = dynamic(
  () => import('@/components/receipts/ReceiptsPageContents'),
  { 
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
  }
);

export default function ReceiptsPage() {
    return (
        <React.Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>}>
            <ReceiptsPageContents />
        </React.Suspense>
    )
}
