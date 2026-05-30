"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { ArrowRight, Loader2, Trash2 } from "lucide-react";

import { db } from "@/lib/firebase/client";
import {
  createPaymentConversion,
  voidPaymentConversion,
  type PaymentConversion,
} from "@/lib/analytics/applyPaymentConversion";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { toJsDate } from "@/lib/utils/date";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ModeOfPayment } from "@/lib/types";

interface PaymentConvertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}

function formatPeso(n: number) {
  return `₱${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(ts: any) {
  const d = toJsDate(ts);
  if (!d) return "";
  return d.toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function PaymentConvertModal({
  open,
  onOpenChange,
  storeId,
}: PaymentConvertModalProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  const [fromMethod, setFromMethod] = useState<string>("");
  const [toMethod, setToMethod] = useState<string>("");
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Active modes of payment from manager/collections — the only methods a
  // conversion can move between (no free-text entry).
  const [activeMethods, setActiveMethods] = useState<string[]>([]);

  const [todayConversions, setTodayConversions] = useState<
    (PaymentConversion & { id: string })[]
  >([]);
  const [loadingList, setLoadingList] = useState(true);

  const todayDayId = useMemo(() => getDayIdFromTimestamp(new Date()), []);

  // Subscribe to the store's active modes of payment while the modal is open.
  useEffect(() => {
    if (!open || !storeId) return;
    const q = query(
      collection(db, "stores", storeId, "storeModesOfPayment"),
      where("isArchived", "==", false),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const names = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as ModeOfPayment)
          .filter((m) => m.isActive)
          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          .map((m) => m.name)
          .filter((n): n is string => !!n);
        setActiveMethods(names);
      },
      (err) => console.error("[PaymentConvertModal] MOP subscription error", err),
    );
    return () => unsub();
  }, [open, storeId]);

  // Seed selects when the modal opens or the active methods change.
  useEffect(() => {
    if (!open) return;
    const defaultFrom = activeMethods[0] ?? "";
    const defaultTo = activeMethods.find((m) => m !== defaultFrom) ?? "";
    setFromMethod((prev) => (prev && activeMethods.includes(prev) ? prev : defaultFrom));
    setToMethod((prev) => (prev && activeMethods.includes(prev) ? prev : defaultTo));
  }, [open, activeMethods]);

  // Reset the entry fields each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setAmountStr("");
    setNote("");
  }, [open]);

  // Subscribe to today's conversions while modal is open.
  useEffect(() => {
    if (!open || !storeId) return;
    setLoadingList(true);
    const q = query(
      collection(db, "stores", storeId, "paymentConversions"),
      where("dayId", "==", todayDayId),
      orderBy("createdAtClientMs", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) }) as PaymentConversion & { id: string },
        );
        setTodayConversions(rows);
        setLoadingList(false);
      },
      (err) => {
        console.error("[PaymentConvertModal] subscription error", err);
        setLoadingList(false);
      },
    );
    return () => unsub();
  }, [open, storeId, todayDayId]);

  const resolvedFrom = fromMethod;
  const resolvedTo = toMethod;

  const parsedAmount = Number(amountStr);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const methodsValid =
    resolvedFrom.length > 0 &&
    resolvedTo.length > 0 &&
    resolvedFrom.toLowerCase() !== resolvedTo.toLowerCase();
  const canSubmit = amountValid && methodsValid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!appUser?.uid) {
      toast({
        title: "Not signed in",
        description: "Please sign in again to record a conversion.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await createPaymentConversion(db, storeId, {
        amount: parsedAmount,
        fromMethod: resolvedFrom,
        toMethod: resolvedTo,
        note: note.trim() || undefined,
        actor: {
          uid: appUser.uid,
          name: appUser.name || appUser.displayName || appUser.username || "Unknown",
          role: appUser.role ?? null,
        },
      });
      toast({
        title: "Conversion recorded",
        description: `${formatPeso(parsedAmount)} moved from ${resolvedFrom} to ${resolvedTo}.`,
      });
      setAmountStr("");
      setNote("");
    } catch (err: any) {
      toast({
        title: "Failed to record conversion",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async (id: string) => {
    if (!appUser?.uid) return;
    const confirmed = await confirm({
      title: "Void this conversion?",
      description: "This reverses its effect on the payment mix.",
      confirmText: "Void",
      destructive: true,
    });
    if (!confirmed) return;
    setVoidingId(id);
    try {
      await voidPaymentConversion(db, storeId, id, {
        uid: appUser.uid,
        name: appUser.name || appUser.displayName || appUser.username || "Unknown",
      });
      toast({ title: "Conversion voided" });
    } catch (err: any) {
      toast({
        title: "Failed to void",
        description: err?.message ?? String(err),
        variant: "destructive",
      });
    } finally {
      setVoidingId(null);
    }
  };

  const renderMethodSelect = (
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
  ) => (
    <Select value={value || ""} onValueChange={setValue} disabled={activeMethods.length === 0}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={activeMethods.length === 0 ? "No active methods" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {activeMethods.map((m) => (
          <SelectItem key={m} value={m} className="capitalize">
            {m}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <>
    {ConfirmDialog}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert Payment Mix</DialogTitle>
          <DialogDescription>
            Shift amounts between payment methods (e.g., GCash cashout: less cash, more gcash).
            This does not alter receipts — it records a new transaction that adjusts the final
            balance per method.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>From (deducted)</Label>
              {renderMethodSelect(fromMethod, setFromMethod, "Select method")}
              {amountValid && resolvedFrom && (
                <div className="text-sm font-semibold tabular-nums text-destructive">
                  −{formatPeso(parsedAmount)}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>To (added)</Label>
              {renderMethodSelect(toMethod, setToMethod, "Select method")}
              {amountValid && resolvedTo && (
                <div className="text-sm font-semibold tabular-nums text-emerald-600">
                  +{formatPeso(parsedAmount)}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="convert-amount">Amount (₱)</Label>
            <Input
              id="convert-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="convert-note">Note (optional)</Label>
            <Input
              id="convert-note"
              placeholder="e.g., GCash cashout for customer"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="h-9"
            />
          </div>

          {resolvedFrom && resolvedTo && amountValid && (
            <div className="text-xs rounded-md bg-muted/60 px-3 py-2 flex items-center gap-2 flex-wrap">
              <span className="capitalize font-medium">{resolvedFrom}</span>
              <span className="tabular-nums text-destructive">−{formatPeso(parsedAmount)}</span>
              <ArrowRight className="h-3 w-3 shrink-0" />
              <span className="capitalize font-medium">{resolvedTo}</span>
              <span className="tabular-nums text-emerald-600">+{formatPeso(parsedAmount)}</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Today's conversions</Label>
              <span className="text-xs text-muted-foreground">
                {todayConversions.length} total
              </span>
            </div>
            <ScrollArea className="h-40 rounded-md border">
              {loadingList ? (
                <div className="flex h-full items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : todayConversions.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No conversions recorded today.
                </div>
              ) : (
                <ul className="divide-y">
                  {todayConversions.map((c) => {
                    const voided = c.status === "voided";
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${voided ? "opacity-60" : ""}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="capitalize font-medium">{c.fromMethod}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="capitalize font-medium">{c.toMethod}</span>
                            <span className="tabular-nums">{formatPeso(Number(c.amount))}</span>
                            {voided && (
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                voided
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {formatTime(c.createdAt) || formatTime(c.createdAtClientMs)}
                            {c.createdBy?.name ? ` · ${c.createdBy.name}` : ""}
                            {c.note ? ` · ${c.note}` : ""}
                          </div>
                        </div>
                        {!voided && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            disabled={voidingId === c.id}
                            onClick={() => handleVoid(c.id)}
                          >
                            {voidingId === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Close
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record conversion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
