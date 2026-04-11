"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PartyPopper, Banknote, Lock, Check } from "lucide-react";
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

const PH_HOLIDAYS = [
  "New Year's Day",
  "Valentine's Day",
  "Chinese New Year",
  "Holy Week",
  "Araw ng Kagitingan",
  "Labor Day",
  "Mother's Day",
  "Independence Day",
  "Father's Day",
  "Eid'l Fitr",
  "Ninoy Aquino Day",
  "National Heroes Day",
  "Bonifacio Day",
  "Halloween",
  "All Saints' Day",
  "All Souls' Day",
  "Christmas Eve",
  "Christmas Day",
  "Rizal Day",
  "New Year's Eve",
];

export function DailyContextLoggerModal({ isOpen, onClose, storeId }: DailyContextLoggerModalProps) {
  const { appUser } = useAuthContext();
  const [existing, setExisting] = useState<DailyContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dayId = getDayIdFromTimestamp(new Date());
  const docRef = doc(db, "stores", storeId, "dailyContext", dayId);

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

  const holidayLocked = !!existing?.holiday;
  const paydayLocked = existing?.isPayday != null;

  async function logHoliday(name: string) {
    if (!appUser || holidayLocked) return;
    setSaving(true);
    try {
      await setDoc(docRef, {
        dayId,
        holiday: {
          name,
          loggedByUid: appUser.uid,
          loggedAt: Timestamp.now(),
        },
      }, { merge: true });
      setExisting((prev) => ({
        ...(prev || { dayId }),
        holiday: { name, loggedByUid: appUser.uid, loggedAt: Timestamp.now() },
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
                <span className="font-semibold text-sm">Is today a holiday or celebration?</span>
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
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {PH_HOLIDAYS.map((name) => (
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start text-xs h-auto py-2 px-3 text-muted-foreground col-span-2"
                    disabled={saving}
                    onClick={() => logHoliday("None")}
                  >
                    Not a holiday today
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
