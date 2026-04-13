"use client";

import { useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loader, PlusCircle, Save, Trash2 } from "lucide-react";

import type { Store, ForecastConfig } from "@/lib/types";

interface ForecastSettingsProps {
  store: Store;
}

export function ForecastSettings({ store }: ForecastSettingsProps) {
  const { toast } = useToast();
  const config = store.forecastConfig ?? {};

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
