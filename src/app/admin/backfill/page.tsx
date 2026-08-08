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
import { rebuildDailyViaServer, rebuildSessionsViaServer, rebuildRollupsViaServer, rebuildPresetsViaServer } from "@/lib/analytics/backfillViaServer";
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
  const [rollupConfirmText, setRollupConfirmText] = useState("");
  const [isRollingUp, setIsRollingUp] = useState(false);
  const [rollupProgress, setRollupProgress] = useState("");
  const [rollupDateRange, setRollupDateRange] = useState<{ start: Date; end: Date }>({
    start: addDays(new Date(), -60),
    end: new Date(),
  });
  const [isRollupCalendarOpen, setIsRollupCalendarOpen] = useState(false);
  const [presetConfirmText, setPresetConfirmText] = useState("");
  const [isRebuildingPresets, setIsRebuildingPresets] = useState(false);
  const [presetProgress, setPresetProgress] = useState("");
  const [sessionsConfirmText, setSessionsConfirmText] = useState("");
  const [isRebuildingSessions, setIsRebuildingSessions] = useState(false);
  const [sessionsProgress, setSessionsProgress] = useState("");
  const [sessionsDateRange, setSessionsDateRange] = useState<{ start: Date; end: Date }>({
    start: addDays(new Date(), -60),
    end: new Date(),
  });
  const [isSessionsCalendarOpen, setIsSessionsCalendarOpen] = useState(false);

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
      const result = await rebuildDailyViaServer(activeStore.id, dateRange.start, dateRange.end);
      setProgressMessage(`Rebuilt ${result.days} day(s) from ${result.receipts} receipt(s).`);
      toast({ title: "Backfill Complete", description: `Rebuilt ${result.days} day(s) from ${result.receipts} receipts.` });
    } catch (error: any) {
      console.error("Backfill failed:", error);
      toast({ variant: 'destructive', title: "Backfill Failed", description: error.message });
      setProgressMessage(`Error: ${error.message}`);
    } finally {
      setIsBackfilling(false);
      setConfirmationText("");
    }
  };
  
  const handleSessionsBackfill = async () => {
    if (appUser?.role !== 'admin') {
        toast({ variant: "destructive", title: "Permission Denied", description: "You are not authorized to perform this action." });
        return;
    }
    if (sessionsConfirmText !== "SESSIONS" || !activeStore) return;

    setIsRebuildingSessions(true);
    setSessionsProgress("Rebuilding session timeline days...");
    toast({ title: "Session Timeline Rebuild Started", description: "Rebuilding per-session rows from historical receipts." });

    try {
      const result = await rebuildSessionsViaServer(activeStore.id, sessionsDateRange.start, sessionsDateRange.end);
      setSessionsProgress(`Rebuilt ${result.days} day(s) / ${result.rows} session row(s) from ${result.receipts} receipt(s).${result.deleted ? ` Removed ${result.deleted} stale day(s).` : ""}`);
      toast({ title: "Session Timeline Rebuilt", description: `${result.rows} session row(s) across ${result.days} day(s).` });
    } catch (error: any) {
      console.error("Session timeline rebuild failed:", error);
      toast({ variant: 'destructive', title: "Rebuild Failed", description: error.message });
      setSessionsProgress(`Error: ${error.message}`);
    } finally {
      setIsRebuildingSessions(false);
      setSessionsConfirmText("");
    }
  };

  const handleRollupBackfill = async () => {
    if (appUser?.role !== 'admin') {
        toast({ variant: "destructive", title: "Permission Denied", description: "You are not authorized to perform this action." });
        return;
    }
    if (rollupConfirmText !== "ROLLUP" || !activeStore) return;

    setIsRollingUp(true);
    setRollupProgress("Starting rollup recompute...");
    toast({ title: "Rollup Recompute Started", description: "Updating month/year session-time rollups." });

    try {
      const result = await rebuildRollupsViaServer(activeStore.id, rollupDateRange.start, rollupDateRange.end);
      setRollupProgress(`Updated ${result.months} month(s) and ${result.years} year(s).`);
      toast({ title: "Rollups Updated", description: `Recomputed ${result.months} month(s) / ${result.years} year(s) from daily docs.` });
    } catch (error: any) {
      console.error("Rollup recompute failed:", error);
      toast({ variant: 'destructive', title: "Rollup Failed", description: error.message });
      setRollupProgress(`Error: ${error.message}`);
    } finally {
      setIsRollingUp(false);
      setRollupConfirmText("");
    }
  };

  const handleRebuildPresets = async () => {
    if (appUser?.role !== 'admin') {
        toast({ variant: "destructive", title: "Permission Denied", description: "You are not authorized to perform this action." });
        return;
    }
    if (presetConfirmText !== "PRESETS" || !activeStore) return;

    setIsRebuildingPresets(true);
    setPresetProgress("Rebuilding dashboard presets...");
    toast({ title: "Preset Rebuild Started", description: "Recomputing dashboard preset rollups from daily docs." });

    try {
      const result = await rebuildPresetsViaServer(activeStore.id);
      setPresetProgress(`Rebuilt ${result.presets} preset(s).`);
      toast({ title: "Presets Rebuilt", description: "Dashboard preset tiles now reflect the daily docs." });
    } catch (error: any) {
      console.error("Preset rebuild failed:", error);
      toast({ variant: 'destructive', title: "Preset Rebuild Failed", description: error.message });
      setPresetProgress(`Error: ${error.message}`);
    } finally {
      setIsRebuildingPresets(false);
      setPresetConfirmText("");
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

            <Card>
                <CardHeader>
                    <CardTitle>Rebuild Daily Session Timeline</CardTitle>
                    <CardDescription>
                        Build the per-session day documents that the Daily Session Timeline page reads, so past
                        dates work there. Safe to re-run.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                      <AlertTitle>Overwrites the selected days</AlertTitle>
                      <AlertDescription>
                          Each day in range is rebuilt from its receipts, so the rebuild is authoritative. Days that
                          end up with no paid sessions are removed. Nothing else is touched — analytics totals,
                          receipts and rollups are left alone.
                      </AlertDescription>
                  </Alert>
                  <div className="grid sm:grid-cols-2 gap-4 items-end">
                      <div className="space-y-2">
                          <Label>Date Range</Label>
                          <Popover open={isSessionsCalendarOpen} onOpenChange={setIsSessionsCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className="w-full justify-start text-left font-normal h-9"
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {sessionsDateRange.end && !isSameDay(sessionsDateRange.start, sessionsDateRange.end) ? (
                                        <>
                                        {format(sessionsDateRange.start, "LLL dd, y")} -{" "}
                                        {format(sessionsDateRange.end, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(sessionsDateRange.start, "LLL dd, y")
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <CompactCalendar
                                    onChange={(range) => { setSessionsDateRange(range); setIsSessionsCalendarOpen(false); }}
                                />
                            </PopoverContent>
                         </Popover>
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="sessions-confirm">Type "SESSIONS" to confirm</Label>
                          <Input
                              id="sessions-confirm"
                              value={sessionsConfirmText}
                              onChange={(e) => setSessionsConfirmText(e.target.value)}
                              placeholder='Type "SESSIONS"'
                              disabled={isRebuildingSessions}
                          />
                      </div>
                  </div>
                  {isRebuildingSessions && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-background rounded-md">
                          <Loader2 className="animate-spin h-4 w-4" />
                          <span>{sessionsProgress}</span>
                      </div>
                  )}
                  {!isRebuildingSessions && sessionsProgress && (
                      <p className="text-sm text-muted-foreground p-2 bg-background rounded-md">{sessionsProgress}</p>
                  )}
                  <Button
                      onClick={handleSessionsBackfill}
                      disabled={isRebuildingSessions || sessionsConfirmText !== "SESSIONS" || !activeStore}
                      className="w-full"
                      variant="secondary"
                  >
                      {isRebuildingSessions ? "Running..." : `Rebuild Session Timeline for ${activeStore?.name || '...'}`}
                  </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Recompute Session-Time Rollups</CardTitle>
                    <CardDescription>
                        Update the month/year rollups that the Data Analysis page reads, so historical average
                        dine-in session time shows there. Run this AFTER the daily backfill above.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                      <AlertTitle>Additive &amp; safe</AlertTitle>
                      <AlertDescription>
                          Recomputes only the dine-in session-duration fields on month/year docs by summing the
                          daily analytics docs in the selected range. Other rollup data is left untouched.
                      </AlertDescription>
                  </Alert>
                  <div className="grid sm:grid-cols-2 gap-4 items-end">
                      <div className="space-y-2">
                          <Label>Date Range</Label>
                          <Popover open={isRollupCalendarOpen} onOpenChange={setIsRollupCalendarOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={"outline"}
                                    className={cn(
                                    "w-full justify-start text-left font-normal h-9",
                                    !rollupDateRange && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {rollupDateRange.start ? (
                                    rollupDateRange.end && !isSameDay(rollupDateRange.start, rollupDateRange.end) ? (
                                        <>
                                        {format(rollupDateRange.start, "LLL dd, y")} -{" "}
                                        {format(rollupDateRange.end, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(rollupDateRange.start, "LLL dd, y")
                                    )
                                    ) : (
                                    <span>Pick a date range</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <CompactCalendar
                                    onChange={(range) => { setRollupDateRange(range); setIsRollupCalendarOpen(false); }}
                                />
                            </PopoverContent>
                         </Popover>
                      </div>
                      <div className="space-y-2">
                          <Label htmlFor="rollup-confirm">Type "ROLLUP" to confirm</Label>
                          <Input
                              id="rollup-confirm"
                              value={rollupConfirmText}
                              onChange={(e) => setRollupConfirmText(e.target.value)}
                              placeholder='Type "ROLLUP"'
                              disabled={isRollingUp}
                          />
                      </div>
                  </div>
                  {isRollingUp && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-background rounded-md">
                          <Loader2 className="animate-spin h-4 w-4" />
                          <span>{rollupProgress}</span>
                      </div>
                  )}
                  <Button
                      onClick={handleRollupBackfill}
                      disabled={isRollingUp || rollupConfirmText !== "ROLLUP" || !activeStore}
                      className="w-full"
                      variant="secondary"
                  >
                      {isRollingUp ? "Running..." : "Recompute Session-Time Rollups"}
                  </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Rebuild Dashboard Presets</CardTitle>
                    <CardDescription>
                        Rebuild the dashboard preset tiles (Today, Yesterday, This Week, Last 7/30, This/Last Month, YTD)
                        from the daily docs, so historical metrics — including average dine-in session time — show on the
                        dashboard. Run this AFTER the daily backfill above.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                      <AlertTitle>Rebuilt from daily docs</AlertTitle>
                      <AlertDescription>
                          Each preset's fixed window (relative to today) is recomputed by summing the daily analytics
                          docs in that window and overwriting the preset doc. No date range needed.
                      </AlertDescription>
                  </Alert>
                  <div className="space-y-2 max-w-xs">
                      <Label htmlFor="preset-confirm">Type "PRESETS" to confirm</Label>
                      <Input
                          id="preset-confirm"
                          value={presetConfirmText}
                          onChange={(e) => setPresetConfirmText(e.target.value)}
                          placeholder='Type "PRESETS"'
                          disabled={isRebuildingPresets}
                      />
                  </div>
                  {isRebuildingPresets && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-background rounded-md">
                          <Loader2 className="animate-spin h-4 w-4" />
                          <span>{presetProgress}</span>
                      </div>
                  )}
                  <Button
                      onClick={handleRebuildPresets}
                      disabled={isRebuildingPresets || presetConfirmText !== "PRESETS" || !activeStore}
                      className="w-full"
                      variant="secondary"
                  >
                      {isRebuildingPresets ? "Running..." : "Rebuild Dashboard Presets"}
                  </Button>
                </CardContent>
            </Card>
        </div>
    </RoleGuard>
  );
}
