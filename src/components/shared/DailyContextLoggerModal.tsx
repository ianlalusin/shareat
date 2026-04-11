"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { PartyPopper, Banknote, Lock, Check, PlusCircle } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import type { DailyContext } from "@/lib/types";

interface DailyContextLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
}

// Fixed-date holidays — auto-detected by month/day
const FIXED_DATE_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 2, day: 14, name: "Valentine's Day" },
  { month: 4, day: 9, name: "Araw ng Kagitingan" },
  { month: 5, day: 1, name: "Labor Day" },
  { month: 6, day: 12, name: "Independence Day" },
  { month: 8, day: 21, name: "Ninoy Aquino Day" },
  { month: 10, day: 31, name: "Halloween" },
  { month: 11, day: 1, name: "All Saints' Day" },
  { month: 11, day: 2, name: "All Souls' Day" },
  { month: 11, day: 30, name: "Bonifacio Day" },
  { month: 12, day: 24, name: "Christmas Eve" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 30, name: "Rizal Day" },
  { month: 12, day: 31, name: "New Year's Eve" },
];

// Non-fixed holidays the user can pick from (dates vary yearly)
const PICKER_HOLIDAYS = [
  "Chinese New Year",
  "Holy Week",
  "Mother's Day",
  "Father's Day",
  "Eid'l Fitr",
  "Eid'l Adha",
  "National Heroes Day",
];

function getTodayFixedHoliday(): string | null {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const match = FIXED_DATE_HOLIDAYS.find(h => h.month === m && h.day === d);
  return match?.name ?? null;
}

export function DailyContextLoggerModal({ isOpen, onClose, storeId }: DailyContextLoggerModalProps) {
  const { appUser } = useAuthContext();
  const [existing, setExisting] = useState<DailyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customEvent, setCustomEvent] = useState("");

  const dayId = getDayIdFromTimestamp(new Date());
  const docRef = doc(db, "stores", storeId, "dailyContext", dayId);
  const todayFixedHoliday = getTodayFixedHoliday();

  useEffect(() => {
    if (!isOpen || !storeId) return;
    setLoading(true);
    getDoc(docRef).then((snap) => {
      if (snap.exists()) {
        setExisting(snap.data() as DailyContext);
      } else {
        setExisting(null);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, storeId]);

  // Auto-log fixed-date holiday when doc is loaded and holiday not yet set
  useEffect(() => {
    if (loading || !appUser || !todayFixedHoliday) return;
    if (existing?.holiday) return; // already logged
    logHoliday(todayFixedHoliday, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, existing, todayFixedHoliday]);

  const holidayLocked = !!existing?.holiday;
  const paydayLocked = existing?.isPayday != null;

  async function logHoliday(name: string, auto = false) {
    if (!appUser || holidayLocked) return;
    setSaving(true);
    try {
      await setDoc(docRef, {
        dayId,
        holiday: {
          name,
          loggedByUid: auto ? "system" : appUser.uid,
          loggedAt: Timestamp.now(),
        },
      }, { merge: true });
      setExisting((prev) => ({
        ...(prev || { dayId }),
        holiday: { name, loggedByUid: auto ? "system" : appUser.uid, loggedAt: Timestamp.now() },
      } as DailyContext));
    } catch (err) {
      console.error("Failed to log holiday:", err);
    } finally {
      setSaving(false);
    }
  }

  async function logPayday(value: boolean) {
    if (!appUser || paydayLocked) return;
    setSaving(true);
    try {
      await setDoc(docRef, {
        dayId,
        isPayday: {
          value,
          loggedByUid: appUser.uid,
          loggedAt: Timestamp.now(),
        },
      }, { merge: true });
      setExisting((prev) => ({
        ...(prev || { dayId }),
        isPayday: { value, loggedByUid: appUser.uid, loggedAt: Timestamp.now() },
      } as DailyContext));
    } catch (err) {
      console.error("Failed to log payday:", err);
    } finally {
      setSaving(false);
    }
  }

  function handleCustomEventSubmit() {
    const trimmed = customEvent.trim();
    if (!trimmed) return;
    logHoliday(trimmed);
    setCustomEvent("");
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Daily Context Log</DialogTitle>
          <DialogDescription>
            Help improve sales forecasting by logging today's context.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Holiday Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <PartyPopper className="h-5 w-5 text-pink-500" />
                <span className="font-semibold text-sm">Is today a holiday or special event?</span>
                {holidayLocked && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                )}
              </div>

              {holidayLocked ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/50 p-3">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">{existing?.holiday?.name}</span>
                  {existing?.holiday?.loggedByUid === "system" && (
                    <Badge variant="secondary" className="text-[10px] ml-auto">Auto-detected</Badge>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Non-fixed-date holidays */}
                  <div className="grid grid-cols-2 gap-2">
                    {PICKER_HOLIDAYS.map((name) => (
                      <Button
                        key={name}
                        variant="outline"
                        size="sm"
                        className="justify-start text-xs h-auto py-2 px-3"
                        disabled={saving}
                        onClick={() => logHoliday(name)}
                      >
                        {name}
                      </Button>
                    ))}
                  </div>

                  {/* Custom event input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder="Custom event (e.g. Graduation Day of Canossa School)"
                      value={customEvent}
                      onChange={(e) => setCustomEvent(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCustomEventSubmit()}
                      disabled={saving}
                      className="text-xs"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving || !customEvent.trim()}
                      onClick={handleCustomEventSubmit}
                    >
                      <PlusCircle className="h-4 w-4" />
                    </Button>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-center text-xs text-muted-foreground"
                    disabled={saving}
                    onClick={() => logHoliday("None")}
                  >
                    Not a holiday / no special event today
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* Payday Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Banknote className="h-5 w-5 text-green-600" />
                <span className="font-semibold text-sm">Is today a payday?</span>
                {paydayLocked && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                )}
              </div>

              {paydayLocked ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50/50 p-3">
                  <Check className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">
                    {existing?.isPayday?.value ? "Yes, it's payday" : "No, not payday"}
                  </span>
                </div>
              ) : (
                <div className="flex gap-3">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    disabled={saving}
                    onClick={() => logPayday(true)}
                  >
                    Yes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={saving}
                    onClick={() => logPayday(false)}
                  >
                    No
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
