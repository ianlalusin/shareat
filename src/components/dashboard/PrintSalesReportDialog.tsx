"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useStoreContext } from "@/context/store-context";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface PrintSalesReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrintSalesReportDialog({ open, onOpenChange }: PrintSalesReportDialogProps) {
  const router = useRouter();
  const { activeStore } = useStoreContext();
  const { settings: receiptSettings } = useReceiptSettings(activeStore?.id ?? null);

  const [reportType, setReportType] = useState<"daily" | "monthly">("daily");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">(
    receiptSettings?.paperWidth === "58mm" ? "58mm" : "80mm"
  );
  const [calendarOpen, setCalendarOpen] = useState(false);

  const monthOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      options.push({
        value: format(d, "yyyy-MM"),
        label: format(d, "MMMM yyyy"),
      });
    }
    return options;
  }, []);

  const handleGenerate = () => {
    const params = new URLSearchParams();
    params.set("type", reportType);
    params.set("width", paperWidth);
    if (reportType === "daily") {
      params.set("date", format(selectedDate, "yyyy-MM-dd"));
    } else {
      params.set("month", selectedMonth);
    }
    onOpenChange(false);
    router.push(`/sales-report?${params.toString()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Print Sales Report</DialogTitle>
          <DialogDescription>
            Configure the report type, date range, and paper size.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Report Type */}
          <div className="space-y-2">
            <Label>Report Type</Label>
            <div className="flex gap-2">
              <Button
                variant={reportType === "daily" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setReportType("daily")}
              >
                Daily
              </Button>
              <Button
                variant={reportType === "monthly" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setReportType("monthly")}
              >
                Monthly
              </Button>
            </div>
          </div>

          {/* Date Selection */}
          <div className="space-y-2">
            <Label>{reportType === "daily" ? "Select Date" : "Select Month"}</Label>
            {reportType === "daily" ? (
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(selectedDate, "MMMM d, yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setCalendarOpen(false);
                      }
                    }}
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
            ) : (
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Paper Width */}
          <div className="space-y-2">
            <Label>Paper Width</Label>
            <Select value={paperWidth} onValueChange={(v) => setPaperWidth(v as "58mm" | "80mm")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="58mm">58mm Thermal</SelectItem>
                <SelectItem value="80mm">80mm Thermal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate}>
            Generate Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
