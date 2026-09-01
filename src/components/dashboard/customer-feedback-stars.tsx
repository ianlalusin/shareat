"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** A 5-star row, filled up to `value` (rounded), the rest shown as outlines. */
export function FeedbackStars({ value, className }: { value: number; className?: string }) {
  const filled = Math.round(value);
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn("h-4 w-4", n <= filled ? "fill-yellow-400 text-yellow-400" : "fill-transparent text-zinc-300")}
        />
      ))}
    </div>
  );
}

/** `Aug 30`-style label, anchored to Asia/Manila regardless of the viewer's device timezone. */
export function formatManilaDate(ms: number, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", ...opts }).format(new Date(ms));
}
