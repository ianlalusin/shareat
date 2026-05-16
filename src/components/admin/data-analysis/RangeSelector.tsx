"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DataAnalysisRange } from "@/hooks/use-data-analysis";

export function RangeSelector({
  value,
  availableYears,
  onChange,
}: {
  value: DataAnalysisRange;
  availableYears: number[];
  onChange: (next: DataAnalysisRange) => void;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const isAllTime = value.kind === "allTime";
  const isYear = value.kind === "year";
  const isCustom = value.kind === "custom";
  const years = availableYears.length > 0 ? availableYears : [new Date().getFullYear()];

  const customLabel = isCustom
    ? `${value.start.toLocaleDateString()} — ${value.end.toLocaleDateString()}`
    : "Custom";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-1">
      <Button
        variant={isAllTime ? "default" : "ghost"}
        size="sm"
        className="h-8"
        onClick={() => onChange({ kind: "allTime" })}
      >
        All-Time
      </Button>
      <div className="flex items-center gap-1">
        <Button
          variant={isYear ? "default" : "ghost"}
          size="sm"
          className="h-8"
          onClick={() => onChange({ kind: "year", year: years[years.length - 1] })}
        >
          Year
        </Button>
        {isYear && (
          <Select
            value={String(value.year)}
            onValueChange={(v) => onChange({ kind: "year", year: parseInt(v, 10) })}
          >
            <SelectTrigger className="h-8 w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <Button variant={isCustom ? "default" : "ghost"} size="sm" className="h-8 min-w-[100px]">
            {customLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <CompactCalendar
            selectionMode="range"
            onChange={(range) => {
              onChange({ kind: "custom", start: range.start, end: range.end });
              setCalOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
