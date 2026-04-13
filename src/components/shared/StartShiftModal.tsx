"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sun, PartyPopper, Check, Loader } from "lucide-react";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

interface StartShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
}

// Known PH holidays for autocomplete suggestions. User can still type custom names.
const KNOWN_HOLIDAYS = [
  "New Year's Day",
  "Valentine's Day",
  "Chinese New Year",
  "Holy Week",
  "Maundy Thursday",
  "Good Friday",
  "Black Saturday",
  "Easter Sunday",
  "Araw ng Kagitingan",
  "Labor Day",
  "Mother's Day",
  "Independence Day",
  "Father's Day",
  "Eid'l Fitr",
  "Eid'l Adha",
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

type Step = "prompt" | "picker" | "saved" | "saving";

export function StartShiftModal({ isOpen, onClose, storeId }: StartShiftModalProps) {
  const { appUser } = useAuthContext();
  const [step, setStep] = useState<Step>("prompt");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const dayId = getDayIdFromTimestamp(new Date());

  // If already answered today, close immediately (suppress blocker)
  useEffect(() => {
    if (!isOpen || !storeId) return;
    setLoading(true);
    setStep("prompt");
    setQuery("");
    getDoc(doc(db, "stores", storeId, "dailyContext", dayId))
      .then((snap) => {
        if (snap.exists() && snap.data()?.holiday) {
          onClose();
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, storeId]);

  const suggestions = useMemo(() => {
    if (!query.trim()) return KNOWN_HOLIDAYS.slice(0, 8);
    const q = query.toLowerCase();
    return KNOWN_HOLIDAYS.filter((h) => h.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  async function writeHoliday(name: string) {
    if (!appUser || !storeId) return;
    setStep("saving");
    try {
      await setDoc(
        doc(db, "stores", storeId, "dailyContext", dayId),
        {
          dayId,
          holiday: {
            name,
            loggedByUid: appUser.uid,
            loggedAt: Timestamp.now(),
          },
        },
        { merge: true }
      );
      setStep("saved");
      setTimeout(() => onClose(), 900);
    } catch {
      setStep("picker");
    }
  }

  async function handleNo() {
    if (!appUser || !storeId) return;
    setStep("saving");
    try {
      await setDoc(
        doc(db, "stores", storeId, "dailyContext", dayId),
        {
          dayId,
          holiday: {
            name: "None",
            loggedByUid: appUser.uid,
            loggedAt: Timestamp.now(),
          },
        },
        { merge: true }
      );
      onClose();
    } catch {
      setStep("prompt");
    }
  }

  function handleYes() {
    setStep("picker");
    setTimeout(() => inputRef.current?.focus(), 80);
  }

  function handleAccept(name?: string) {
    const value = (name ?? query).trim();
    if (!value) return;
    writeHoliday(value);
  }

  return (
    // Blocking dialog: no onOpenChange close, no escape/overlay close
    <Dialog open={isOpen}>
      <DialogContent
        className="sm:max-w-sm [&>button]:hidden"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-amber-500" />
            Start of Shift
          </DialogTitle>
          <DialogDescription>Quick check before you begin — helps the forecast AI.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : step === "prompt" ? (
          <div className="py-4 space-y-4">
            <p className="text-center font-medium">
              Is today a holiday or special occasion?
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={handleNo}>
                No
              </Button>
              <Button onClick={handleYes}>
                <PartyPopper className="h-4 w-4 mr-1" />
                Yes
              </Button>
            </div>
          </div>
        ) : step === "picker" ? (
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Type the occasion. Suggestions match known holidays — or type your own.
            </p>
            <Input
              ref={inputRef}
              placeholder="e.g. Chinese New Year, Store Anniversary"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAccept();
                }
              }}
              autoFocus
            />
            {suggestions.length > 0 && (
              <div className="border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleAccept(name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-b-0"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setStep("prompt")}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => handleAccept()} disabled={!query.trim()}>
                Save "{query.trim() || "…"}"
              </Button>
            </div>
          </div>
        ) : step === "saving" ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 my-2">
            <Check className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">Saved — have a great shift!</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
