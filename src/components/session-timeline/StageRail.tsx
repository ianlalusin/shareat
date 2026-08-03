"use client";

import { cn } from "@/lib/utils";
import type { SessionStage } from "@/lib/session-timeline/stages";
import { StageCard } from "./StageCard";

/**
 * The stage sequence.
 *
 * Below `lg` it is a vertical stepper with a left gutter line — the same idiom
 * as the session timeline drawer, so the two read as one system. At `lg` and up
 * it flips to a horizontal rail with the connector running through the node
 * dots. Stages that do not fit scroll horizontally rather than compressing,
 * which keeps a twenty-refill session from squeezing every other stage into a
 * sliver.
 */
export function StageRail({ stages, focusId }: { stages: SessionStage[]; focusId?: string | null }) {
  return (
    <ol
      className={cn(
        "grid gap-3",
        "lg:grid-flow-col lg:auto-cols-[minmax(230px,1fr)] lg:gap-0 lg:overflow-x-auto lg:snap-x lg:pb-2"
      )}
    >
      {stages.map((stage) => {
        // A service stage with a long list gets twice the width on the rail so
        // its items stay readable.
        const wide = stage.kind === "service" && (stage.items?.length ?? 0) > 4;
        return (
          <li
            key={stage.kind}
            className={cn(
              "relative pl-8 lg:pl-0 lg:pt-8 lg:px-2 lg:snap-start",
              wide && "lg:col-span-2"
            )}
            style={wide ? { gridColumn: "span 2" } : undefined}
          >
            {/* Vertical gutter (mobile) — stops at the last node rather than
                trailing off the end of the list. */}
            <span
              className="absolute left-3 top-0 bottom-0 w-px bg-border lg:hidden [li:last-child>&]:h-4 [li:last-child>&]:bottom-auto"
              aria-hidden
            />
            {/* Horizontal connector (desktop), masked at the two ends. */}
            <span
              className="hidden lg:block absolute top-3 left-0 right-0 h-px bg-border [li:first-child>&]:left-1/2 [li:last-child>&]:right-1/2"
              aria-hidden
            />
            <span
              className={cn(
                "absolute h-3 w-3 rounded-full border-2 bg-background",
                "left-3 top-4 -translate-x-1/2",
                "lg:left-1/2 lg:top-2 lg:-translate-x-1/2",
                stage.tone === "danger" ? "border-red-500"
                  : stage.tone === "warn" ? "border-amber-500"
                  : "border-primary"
              )}
              aria-hidden
            />
            <StageCard stage={stage} focusId={focusId} />
          </li>
        );
      })}
    </ol>
  );
}
