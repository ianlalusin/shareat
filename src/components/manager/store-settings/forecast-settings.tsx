"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loader, PlusCircle, Save, Target, Trash2 } from "lucide-react";

import type { Store, ForecastConfig } from "@/lib/types";

interface ForecastSettingsProps {
  store: Store;
}

function todayDateString(): string {
  const manila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const y = manila.getFullYear();
  const m = String(manila.getMonth() + 1).padStart(2, "0");
  const d = String(manila.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function ForecastSettings({ store }: ForecastSettingsProps) {
  const { toast } = useToast();
  const { appUser } = useAuthContext();
  const config = store.forecastConfig ?? {};

  // Sales target override state
  const [targetDate, setTargetDate] = useState(todayDateString());
  const [targetAmount, setTargetAmount] = useState<string>("");
  const [currentTarget, setCurrentTarget] = useState<{ amount: number; setAt?: any } | null>(null);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [isClearingTarget, setIsClearingTarget] = useState(false);

  // Live read of today's target for status display
  useEffect(() => {
    if (!store?.id) return;
    const today = todayDateString();
    const ref = doc(db, "stores", store.id, "salesTargets", today);
    return onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setCurrentTarget({ amount: Number(data.amount) || 0, setAt: data.setAt });
      } else {
        setCurrentTarget(null);
      }
    });
  }, [store?.id]);

  async function handleSaveTarget() {
    const amount = parseFloat(targetAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Enter a positive number.", variant: "destructive" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      toast({ title: "Invalid date", description: "Pick a valid date.", variant: "destructive" });
      return;
    }
    setIsSavingTarget(true);
    try {
      const ref = doc(db, "stores", store.id, "salesTargets", targetDate);
      await setDoc(ref, {
        date: targetDate,
        amount,
        setByUid: appUser?.uid ?? null,
        setAt: serverTimestamp(),
      }, { merge: true });
      toast({ title: "Target saved", description: `₱${amount.toLocaleString()} target for ${targetDate}.` });
      setTargetAmount("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to save.", variant: "destructive" });
    } finally {
      setIsSavingTarget(false);
    }
  }

  async function handleClearTodayTarget() {
    setIsClearingTarget(true);
    try {
      const today = todayDateString();
      const ref = doc(db, "stores", store.id, "salesTargets", today);
      await setDoc(ref, { amount: 0, clearedAt: serverTimestamp() }, { merge: true });
      toast({ title: "Target cleared", description: "Cashier will now see the forecasted amount." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to clear.", variant: "destructive" });
    } finally {
      setIsClearingTarget(false);
    }
  }

  const [holidays, setHolidays] = useState<{ name: string; date: string }[]>(config.customHolidays ?? []);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayDate, setNewHolidayDate] = useState("");

  const [customPayrollDates, setCustomPayrollDates] = useState(
    (config.customPayrollDates ?? []).join(", ")
  );

  const [storeContext, setStoreContext] = useState(config.storeContext ?? "");
  const [isSaving, setIsSaving] = useState(false);

  function addHoliday() {
    if (!newHolidayName.trim() || !newHolidayDate) return;
    if (holidays.length >= 50) {
      toast({ title: "Limit reached", description: "Maximum 50 custom holidays.", variant: "destructive" });
      return;
    }
    setHolidays((prev) => [...prev, { name: newHolidayName.trim(), date: newHolidayDate }]);
    setNewHolidayName("");
    setNewHolidayDate("");
  }

  function removeHoliday(index: number) {
    setHolidays((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const parsedCustomDates = customPayrollDates
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 1 && n <= 31);

      const forecastConfig: ForecastConfig = {
        customHolidays: holidays,
        payrollScheduleType: "custom",
        customPayrollDates: parsedCustomDates,
        storeContext: storeContext.trim().slice(0, 500),
      };

      const storeRef = doc(db, "stores", store.id);
      await updateDoc(storeRef, { forecastConfig, updatedAt: serverTimestamp() });

      toast({ title: "Saved", description: "Forecast settings updated." });
    } catch (err: any) {
      console.error("Save forecast config failed:", err);
      toast({ title: "Error", description: err.message || "Failed to save.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Custom Holidays */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom Holidays</CardTitle>
          <CardDescription>
            Add holidays that may affect sales. These replace the default holiday list for forecasting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {holidays.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[60px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holidays.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell>{h.name}</TableCell>
                      <TableCell>{h.date}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeHoliday(i)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label>Holiday Name</Label>
              <Input
                placeholder="e.g. Independence Day"
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={newHolidayDate}
                onChange={(e) => setNewHolidayDate(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={addHoliday} disabled={!newHolidayName.trim() || !newHolidayDate}>
              <PlusCircle className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Paydays */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paydays</CardTitle>
          <CardDescription>
            Days of the month that are paydays. Sales tend to spike around these days, which helps the forecast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Days of the month</Label>
            <Input
              placeholder="e.g. 5, 20"
              value={customPayrollDates}
              onChange={(e) => setCustomPayrollDates(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated day numbers (1–31). For example, <code>15, 30</code> means the 15th and 30th of every month.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sales Target Override */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            Sales Target Override
          </CardTitle>
          <CardDescription>
            Set a daily sales target that replaces the AI forecast on the cashier page. If you don't set one, the cashier sees the AI forecast.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentTarget && currentTarget.amount > 0 ? (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Today's target (active)</p>
                <p className="text-2xl font-black text-primary">
                  ₱{currentTarget.amount.toLocaleString()}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleClearTodayTarget} disabled={isClearingTarget}>
                {isClearingTarget ? <Loader className="h-4 w-4 animate-spin" /> : "Clear"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              No target set for today. Cashier is showing the AI forecast.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} disabled={isSavingTarget} />
            </div>
            <div className="space-y-1">
              <Label>Target amount (₱)</Label>
              <Input
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 15000"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                disabled={isSavingTarget}
              />
            </div>
            <Button onClick={handleSaveTarget} disabled={isSavingTarget || !targetAmount}>
              {isSavingTarget ? <Loader className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save Target
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Targets for future dates are allowed — set the whole week's goals in advance if you want.
          </p>
        </CardContent>
      </Card>

      {/* Store Context */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Store Context</CardTitle>
          <CardDescription>
            Describe anything unique about your store that might affect sales patterns. This is passed to the AI forecasting model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="e.g. Near a university campus, busy during enrollment periods. Adjacent to a park, higher foot traffic on weekends."
            value={storeContext}
            onChange={(e) => setStoreContext(e.target.value)}
            maxLength={500}
            rows={3}
          />
          <p className="text-xs text-muted-foreground mt-1">{storeContext.length}/500</p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Forecast Settings
        </Button>
      </div>
    </div>
  );
}
