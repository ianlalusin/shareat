
"use client"

import * as React from "react"
import { addDays, format, subDays, startOfMonth, endOfMonth, isSameDay, startOfDay, endOfDay } from "date-fns"
import { Calendar as CalendarIcon, ChevronRight } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"
import { Label } from "../ui/label"
import { Input } from "../ui/input"

const PRESETS = [
  { label: "Today", getValue: () => ({ from: startOfDay(new Date()), to: endOfDay(new Date()) }) },
  { label: "Yesterday", getValue: () => ({ from: startOfDay(subDays(new Date(), 1)), to: endOfDay(subDays(new Date(), 1)) }) },
  { label: "Last 7 days", getValue: () => ({ from: startOfDay(subDays(new Date(), 6)), to: endOfDay(new Date()) }) },
  { label: "Last 30 days", getValue: () => ({ from: startOfDay(subDays(new Date(), 29)), to: endOfDay(new Date()) }) },
  { label: "This month", getValue: () => ({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) }) },
  { label: "Last month", getValue: () => ({ from: startOfMonth(subDays(startOfMonth(new Date()), 1)), to: endOfMonth(subDays(startOfMonth(new Date()), 1)) }) },
]


export function DateRangePicker({
  className,
  onUpdate,
}: React.HTMLAttributes<HTMLDivElement> & { onUpdate?: (range: DateRange | undefined) => void }) {
  const [date, setDate] = React.useState<DateRange | undefined>({
    from: startOfDay(new Date()),
    to: endOfDay(new Date()),
  })
  const [isOpen, setIsOpen] = React.useState(false)
  const [showCustomPicker, setShowCustomPicker] = React.useState(false);
  const [startDateInput, setStartDateInput] = React.useState('');
  const [endDateInput, setEndDateInput] = React.useState('');

  const handleApply = () => {
    if(onUpdate) {
        onUpdate(date);
    }
    setIsOpen(false);
  }
  
   const handleCustomClick = () => {
    setShowCustomPicker(true);
    setStartDateInput(date?.from ? format(date.from, 'MM/dd/yyyy') : '');
    setEndDateInput(date?.to ? format(date.to, 'MM/dd/yyyy') : '');
  };

  const handlePresetClick = (presetValue: DateRange) => {
    setDate(presetValue);
    setShowCustomPicker(false);
  };
  
  const handleApplyCustomDate = () => {
      const from = new Date(startDateInput);
      const to = new Date(endDateInput);
      const newRange = { from: startOfDay(from), to: endOfDay(to) };
      setDate(newRange);
      setShowCustomPicker(false);
  }

  const isPresetActive = (presetValue: DateRange) => {
    if (!date?.from || !date.to) return false;
    return isSameDay(presetValue.from, date.from) && isSameDay(presetValue.to, date.to);
  };

  return (
    <div className={cn("grid gap-2", className)}>
       <div className="flex flex-wrap items-start gap-2">
          <Button variant={isPresetActive(PRESETS[0].getValue()) ? 'secondary': "outline"} size="sm" onClick={() => handlePresetClick(PRESETS[0].getValue())}>
            Today
          </Button>
          <Collapsible>
            <div className="flex items-start gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9 data-[state=open]:rotate-90">
                    <ChevronRight className="h-4 w-4 transition-transform" />
                    <span className="sr-only">Toggle date presets</span>
                  </Button>
                </CollapsibleTrigger>
              <CollapsibleContent asChild>
                <div className="flex flex-col items-start gap-2 sm:flex-row animate-in fade-in duration-300">
                  {!showCustomPicker ? (
                    <>
                      <Button variant={isPresetActive(PRESETS[1].getValue()) ? 'secondary': "outline"} size="sm" onClick={() => handlePresetClick(PRESETS[1].getValue())}>
                        Yesterday
                      </Button>
                      <Button variant={isPresetActive(PRESETS[2].getValue()) ? 'secondary': "outline"} size="sm" onClick={() => handlePresetClick(PRESETS[2].getValue())}>
                        Last 7 Days
                      </Button>
                      <Button variant={isPresetActive(PRESETS[4].getValue()) ? 'secondary': "outline"} size="sm" onClick={() => handlePresetClick(PRESETS[4].getValue())}>
                        This Month
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleCustomClick}>
                        Custom
                      </Button>
                    </>
                  ) : (
                     <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm">
                        <div className="flex items-center gap-4">
                           <div className="grid gap-2">
                                <Label htmlFor="start-date">Start date</Label>
                                <Input id="start-date" value={startDateInput} onChange={e => setStartDateInput(e.target.value)} placeholder="mm/dd/yyyy" />
                           </div>
                            <div className="grid gap-2">
                                <Label htmlFor="end-date">End date</Label>
                                <Input id="end-date" value={endDateInput} onChange={e => setEndDateInput(e.target.value)} placeholder="mm/dd/yyyy" />
                            </div>
                        </div>
                         <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setShowCustomPicker(false)}>Cancel</Button>
                            <Button onClick={handleApplyCustomDate}>Apply</Button>
                         </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
    </div>
  )
}
