

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DateRangePicker } from "../ui/date-range-picker";
import { addDays } from "date-fns";
import { Loader2 } from "lucide-react";
import { rebuildDailyAnalyticsFromReceipts } from "@/lib/analytics/backfill";
import { db } from "@/lib/firebase/client";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function BackfillTool() {
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

  if (appUser?.role !== 'admin') {
    return null; // This component is strictly for admins
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

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="backfill-tool" className="border-b-0">
        <Card className="bg-muted/30">
          <AccordionTrigger className="p-6 hover:no-underline [&>svg]:ml-auto">
              <div className="text-left">
                <CardTitle>Analytics Backfill Tool</CardTitle>
                <CardDescription>
                    Rebuild daily analytics data from historical receipts for a selected date range.
                </CardDescription>
              </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
              <div className="space-y-4">
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
                          <DateRangePicker onDateChange={setDateRange} />
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
              </div>
          </AccordionContent>
        </Card>
      </AccordionItem>
    </Accordion>
  );
}
