"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { addDays, format } from "date-fns";
import { Loader2, Calendar as CalendarIcon, ArrowLeft } from "lucide-react";
import { rebuildDailyAnalyticsFromReceipts } from "@/lib/analytics/backfill";
import { db } from "@/lib/firebase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import CompactCalendar from "@/components/ui/CompactCalendar";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { isSameDay } from "@/lib/utils/date";

export default function BackfillPage() {
  const router = useRouter();
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();

  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
    start: addDays(new Date(), -60),
    end: new Date(),
  });
  const [confirmationText, setConfirmationText] = useState("");
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  if (appUser?.role !== 'admin') {
    return null; // This page is strictly for admins, RoleGuard will handle redirect
  }

  const handleBackfill = async () => {
    if (appUser?.role !== 'admin') {
        toast({ variant: "destructive", title: "Permission Denied", description: "You are not authorized to perform this action." });
        return;
    }
    if (confirmationText !== "REBUILD" || !activeStore) return;

    setIsBackfilling(true);
    setProgressMessage("Starting backfill process...");
    toast({ title: "Backfill Started", description: "Processing historical receipts. This may take some time." });

    try {
      await rebuildDailyAnalyticsFromReceipts(
        db,
        activeStore.id,
        dateRange.start,
        dateRange.end,
        (message) => {
          console.log(`[Backfill]: ${message}`);
          setProgressMessage(message);
        }
      );
      toast({ title: "Backfill Complete", description: "Analytics data has been successfully rebuilt." });
    } catch (error: any) {
      console.error("Backfill failed:", error);
      toast({ variant: 'destructive', title: "Backfill Failed", description: error.message });
      setProgressMessage(`Error: ${error.message}`);
    } finally {
      setIsBackfilling(false);
      setConfirmationText("");
    }
  };
  
  const handleCalendarChange = (range: { start: Date; end: Date }) => {
    setDateRange(range);
    setIsCalendarOpen(false);
  };

  return (
    <RoleGuard allow={["admin"]}>
        <PageHeader title="Analytics Backfill Tool" description="Rebuild daily analytics data from historical receipts for a selected date range.">
            <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
        </PageHeader>
        <div className="max-w-4xl mx-auto space-y-4 mt-6">
            <Card>
                <CardHeader>
                    <CardTitle>Run Backfill</CardTitle>
                    <CardDescription>Select a date range to rebuild analytics data.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert variant="destructive">
                      <AlertTitle>Warning: Overwrite Operation</AlertTitle>
                      <AlertDescription>
                          This tool will overwrite any existing daily analytics documents within the selected date range.
                          This action is irreversible. Use with caution.
                      </AlertDescription>
                  </Alert>
                  <div className="grid sm:grid-cols-2 gap-4 items-end">
                      <div className="space-y-2">
                          <Label>Date Range</Label>
                          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full justify-start text-left font-normal h-9",
                                    !dateRange && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRange.start ? (
                                    dateRange.end && !isSameDay(dateRange.start, dateRange.end) ? (
                                        <>
                                        {format(dateRange.start, "LLL dd, y")} -{" "}
                                        {format(dateRange.end, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(dateRange.start, "LLL dd, y")
                                    )
                                    ) : (
                                    <span>Pick a date range</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <CompactCalendar
                                    onChange={(range) => handleCalendarChange(range)}
                                />
                            </PopoverContent>
                         </Popover>
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="rebuild-confirm">Type "REBUILD" to confirm</Label>
                          <Input
                              id="rebuild-confirm"
                              value={confirmationText}
                              onChange={(e) => setConfirmationText(e.target.value)}
                              placeholder='Type "REBUILD"'
                              disabled={isBackfilling}
                          />
                      </div>
                  </div>
                  {isBackfilling && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-background rounded-md">
                          <Loader2 className="animate-spin h-4 w-4" />
                          <span>{progressMessage}</span>
                      </div>
                  )}
                  <Button
                      onClick={handleBackfill}
                      disabled={isBackfilling || confirmationText !== "REBUILD" || !activeStore}
                      className="w-full"
                  >
                      {isBackfilling ? "Running..." : `Rebuild Analytics for ${activeStore?.name || '...'}`}
                  </Button>
                </CardContent>
            </Card>
        </div>
    </RoleGuard>
  );
}
