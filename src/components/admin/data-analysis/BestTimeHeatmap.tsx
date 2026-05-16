"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DataAnalysisResult } from "@/hooks/use-data-analysis";
import { formatCurrency } from "./formatters";

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cellColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return "hsl(var(--muted))";
  const intensity = Math.min(1, value / max);
  // Interpolate between very light and brand primary
  const alpha = 0.15 + intensity * 0.75;
  return `hsla(142, 76%, 36%, ${alpha.toFixed(2)})`;
}

export function BestTimeHeatmap({ bestTime }: { bestTime: DataAnalysisResult["bestTime"] }) {
  const max = bestTime.matrix.reduce((m, row) => Math.max(m, ...row), 0);
  const peakHours = Array.from({ length: 24 }, (_, h) => {
    let total = 0;
    for (let d = 0; d < 7; d++) total += bestTime.matrix[d][h];
    return { hour: h, total };
  }).sort((a, b) => b.total - a.total).slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Best Time</CardTitle>
        <CardDescription>
          Estimated sales intensity by day of week × hour of day. Peak hours:&nbsp;
          {peakHours.length > 0
            ? peakHours.map((p) => `${p.hour}:00`).join(", ")
            : "—"}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <div className="inline-block min-w-full">
          <div className="grid" style={{ gridTemplateColumns: "auto repeat(24, minmax(20px, 1fr))" }}>
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-[10px] text-muted-foreground text-center px-0.5">
                {h}
              </div>
            ))}
            {DOW_LABELS.map((label, d) => (
              <div key={d} className="contents">
                <div className="text-xs text-muted-foreground pr-2 self-center">{label}</div>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = bestTime.matrix[d][h];
                  return (
                    <div
                      key={h}
                      title={`${label} ${h}:00 — ${formatCurrency(v)}`}
                      className="h-6 m-0.5 rounded-sm border border-border/30"
                      style={{ background: cellColor(v, max) }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
