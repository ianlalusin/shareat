"use client";

import { useState, useEffect } from "react";
import { ClipboardEdit } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { doc, onSnapshot } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { DailyContextLoggerModal } from "@/components/shared/DailyContextLoggerModal";
import type { DailyContext } from "@/lib/types";

interface DailyContextFloatingButtonProps {
  storeId: string;
}

export function DailyContextFloatingButton({ storeId }: DailyContextFloatingButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [context, setContext] = useState<DailyContext | null>(null);

  useEffect(() => {
    if (!storeId) return;
    const dayId = getDayIdFromTimestamp(new Date());
    const ref = doc(db, "stores", storeId, "dailyContext", dayId);

    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setContext(snap.data() as DailyContext);
      } else {
        setContext(null);
      }
    });
  }, [storeId]);

  const holidayDone = !!context?.holiday;
  const paydayDone = context?.isPayday != null;
  const allDone = holidayDone && paydayDone;

  // Pulsing dot when incomplete
  const dotColor = allDone ? "bg-green-400" : "bg-amber-400 animate-pulse";

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 h-12 w-12 rounded-full shadow-lg z-50 bg-zinc-800 flex items-center justify-center hover:shadow-xl hover:scale-105 active:scale-95 transition-all duration-150 border-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
        aria-label="Log daily context"
      >
        <ClipboardEdit className="h-5 w-5 text-white" strokeWidth={1.8} />
        <span className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-800 ${dotColor}`} />
      </button>

      <DailyContextLoggerModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        storeId={storeId}
      />
    </>
  );
}
