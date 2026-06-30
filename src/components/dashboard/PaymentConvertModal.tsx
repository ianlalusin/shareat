"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { ArrowRight, Loader2, Trash2, Lock } from "lucide-react";

import { db } from "@/lib/firebase/client";
import { type PaymentConversion } from "@/lib/analytics/applyPaymentConversion";
import {
  netByMethod,
  activeConversionCount,
  groupConversionsByDay,
  type ConversionNet,
} from "@/lib/analytics/paymentConversionSummary";
import {
  createPaymentConversionViaServer,
  voidPaymentConversionViaServer,
} from "@/lib/analytics/paymentConversionClient";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { useAuthContext } from "@/context/auth-context";
import { useLocalProfile } from "@/context/local-profile-context";
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
import { MoneyConvertAnimation, type ConvertDirection } from "@/components/dashboard/MoneyConvertAnimation";
import type { ModeOfPayment } from "@/lib/types";

/** A payment method is "physical" cash when its name reads like cash. Mirrors
 *  the cash detection used elsewhere (e.g. lib/cash/handover). */
function isCashMethod(name: string) {
  return name.trim().toLowerCase().includes("cash");
}

/**
 * The money-morph animation only makes sense when exactly one side is physical
 * cash (cash <-> digital). Returns the direction, or null for cash->cash and
 * digital->digital moves where no physical/digital transformation occurs.
 */
function convertDirection(from: string, to: string): ConvertDirection | null {
  if (!from || !to) return null;
  const fromCash = isCashMethod(from);
  const toCash = isCashMethod(to);
  if (fromCash === toCash) return null; // both cash or both digital
  return toCash ? "toCash" : "toDigital";
}

interface PaymentConvertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Active dashboard date range — the modal's history reflects this window. */
  rangeStart: Date;
  rangeEnd: Date;
  /** Human label for the active range (e.g. "Jun 1 - Jun 28"). */
  rangeLabel: string;
  /** True only when the dashboard preset is "Today" — recording is gated to it. */
  isToday: boolean;
}

function formatPeso(n: number) {
  return `₱${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Signed peso for net summaries: "−₱5,000.00" / "+₱5,000.00". */
function formatSignedPeso(n: number) {
  return `${n < 0 ? "−" : "+"}${formatPeso(n)}`;
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

/** "20260628" -> "Jun 28" for day-group headers. */
function formatDayId(dayId: string) {
  if (!/^\d{8}$/.test(dayId)) return dayId;
  const y = Number(dayId.slice(0, 4));
  const m = Number(dayId.slice(4, 6)) - 1;
  const d = Number(dayId.slice(6, 8));
  return new Date(y, m, d).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** Render the non-zero net moves of a method->amount map as inline chips. */
function NetSummary({ net, emptyText }: { net: ConversionNet; emptyText: string }) {
  const entries = Object.entries(net)
    .filter(([, v]) => Math.round(v * 100) !== 0)
    .sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return <span className="text-muted-foreground">{emptyText}</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {entries.map(([method, val]) => (
        <span key={method} className="capitalize tabular-nums">
          {method}{" "}
          <span className={val < 0 ? "text-destructive" : "text-emerald-600"}>
            {formatSignedPeso(val)}
          </span>
        </span>
      ))}
    </span>
  );
}

export function PaymentConvertModal({
  open,
  onOpenChange,
  storeId,
  rangeStart,
  rangeEnd,
  rangeLabel,
  isToday,
}: PaymentConvertModalProps) {
  const { appUser } = useAuthContext();
  const { currentProfile } = useLocalProfile();
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  // Attribute conversions to the device's selected local profile (the actual
  // person on shift), not the shared device account. Falls back to the account
  // when no local profile is signed in.
  const actorName = currentProfile?.name || appUser?.name || appUser?.displayName || appUser?.username || "Unknown";

  const [fromMethod, setFromMethod] = useState<string>("");
  const [toMethod, setToMethod] = useState<string>("");
  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Success animation overlay. `successAnim` holds the snapshot of the move to
  // celebrate; `successPlay` bumps to replay if two records happen in a row.
  const [successAnim, setSuccessAnim] = useState<{
    direction: ConvertDirection;
    amount: number;
    fromLabel: string;
    toLabel: string;
  } | null>(null);
  const [successPlay, setSuccessPlay] = useState(0);

  // Active modes of payment from manager/collections — the only methods a
  // conversion can move between (no free-text entry).
  const [activeMethods, setActiveMethods] = useState<string[]>([]);

  const [conversions, setConversions] = useState<
    (PaymentConversion & { id: string })[]
  >([]);
  const [loadingList, setLoadingList] = useState(true);

  const todayDayId = useMemo(() => getDayIdFromTimestamp(new Date()), []);
  const startDayId = useMemo(() => getDayIdFromTimestamp(rangeStart), [rangeStart]);
  const endDayId = useMemo(() => getDayIdFromTimestamp(rangeEnd), [rangeEnd]);
  const isMultiDay = startDayId !== endDayId;

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
    setSuccessAnim(null);
  }, [open]);

  // Subscribe to the conversions in the active date range while modal is open.
  // dayId is a YYYYMMDD string, so a [start,end] range is a lexicographic range
  // (single-field, no composite index). Entries are grouped/sorted client-side.
  useEffect(() => {
    if (!open || !storeId) return;
    setLoadingList(true);
    const q = query(
      collection(db, "stores", storeId, "paymentConversions"),
      where("dayId", ">=", startDayId),
      where("dayId", "<=", endDayId),
      orderBy("dayId", "desc"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map(
          (d) => ({ id: d.id, ...(d.data() as any) }) as PaymentConversion & { id: string },
        );
        setConversions(rows);
        setLoadingList(false);
      },
      (err) => {
        console.error("[PaymentConvertModal] subscription error", err);
        setLoadingList(false);
      },
    );
    return () => unsub();
  }, [open, storeId, startDayId, endDayId]);

  const rangeNet = useMemo(() => netByMethod(conversions), [conversions]);
  const activeCount = useMemo(() => activeConversionCount(conversions), [conversions]);
  const dayGroups = useMemo(() => groupConversionsByDay(conversions), [conversions]);

  const resolvedFrom = fromMethod;
  const resolvedTo = toMethod;

  // Direction for the cash <-> digital morph (null when no physical money is
  // involved, e.g. gcash -> card).
  const previewDirection = useMemo(
    () => convertDirection(resolvedFrom, resolvedTo),
    [resolvedFrom, resolvedTo],
  );

  const parsedAmount = Number(amountStr);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const methodsValid =
    resolvedFrom.length > 0 &&
    resolvedTo.length > 0 &&
    resolvedFrom.toLowerCase() !== resolvedTo.toLowerCase();
  const canSubmit = isToday && amountValid && methodsValid && !submitting;

  const handleSubmit = async () => {
    if (!isToday || !canSubmit) return;
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
      await createPaymentConversionViaServer(storeId, {
        amount: parsedAmount,
        fromMethod: resolvedFrom,
        toMethod: resolvedTo,
        note: note.trim() || undefined,
        actorName,
      });
      // Celebrate cash <-> digital moves with the money-morph overlay.
      const dir = convertDirection(resolvedFrom, resolvedTo);
      if (dir) {
        setSuccessAnim({
          direction: dir,
          amount: parsedAmount,
          fromLabel: resolvedFrom,
          toLabel: resolvedTo,
        });
        setSuccessPlay((n) => n + 1);
      }
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
      await voidPaymentConversionViaServer(storeId, id, actorName);
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
    <Select
      value={value || ""}
      onValueChange={setValue}
      disabled={!isToday || activeMethods.length === 0}
    >
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

  // A conversion row (shared by single-day and grouped renders). Void is offered
  // only on the Today view and only for today's own (still-mutable) conversions.
  const renderRow = (c: PaymentConversion & { id: string }) => {
    const voided = c.status === "voided";
    const canVoidRow = isToday && c.dayId === todayDayId && !voided;
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
        {canVoidRow && (
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
  };

  return (
    <>
    {ConfirmDialog}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Success overlay — celebratory cash <-> digital morph on record. */}
        {successAnim && (
          <div
            className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/92 backdrop-blur-[2px]"
            onClick={() => setSuccessAnim(null)}
          >
            <div className="w-full max-w-xs px-6">
              <MoneyConvertAnimation
                mode="success"
                playKey={successPlay}
                direction={successAnim.direction}
                amount={successAnim.amount}
                fromLabel={successAnim.fromLabel}
                toLabel={successAnim.toLabel}
                onDone={() => setSuccessAnim(null)}
              />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {successAnim.direction === "toCash"
                ? "Converted to cash"
                : "Converted to digital"}
            </p>
          </div>
        )}

        <DialogHeader>
          <DialogTitle>Convert Payment Mix</DialogTitle>
          <DialogDescription>
            Shift amounts between payment methods (e.g., GCash cashout: less cash, more gcash).
            This does not alter receipts — it records a transaction that adjusts the final
            balance per method.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Range net summary — the aggregate effect on the mix for the window. */}
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">Net · {rangeLabel}</span>
              <span className="text-muted-foreground">{activeCount} conversion{activeCount === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-1">
              <NetSummary net={rangeNet} emptyText="No conversions in this range." />
            </div>
          </div>

          {/* Record form — only on Today. Off-Today the modal becomes a
              read-only history viewer, so we hide the disabled inputs entirely
              (instead of greying them out) and give the conversion list more
              room below. A compact lock line explains why there's no form. */}
          {isToday ? (
            <div className="space-y-4">
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

              {/* Live cash <-> digital morph reflecting the current selection. */}
              {previewDirection && resolvedFrom && resolvedTo && (
                <div className="rounded-md border bg-muted/30 px-3 py-3">
                  <MoneyConvertAnimation
                    mode="preview"
                    direction={previewDirection}
                    fromLabel={resolvedFrom}
                    toLabel={resolvedTo}
                  />
                  <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
                    {previewDirection === "toCash"
                      ? "Digital balance → physical cash"
                      : "Physical cash → digital balance"}
                  </p>
                </div>
              )}

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
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              <span>Read-only — switch to <span className="font-medium">Today</span> to record a conversion.</span>
            </div>
          )}

          {/* History — respects the active date range. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{isMultiDay ? "Conversions in range" : "Conversions"}</Label>
              <span className="text-xs text-muted-foreground">{conversions.length} total</span>
            </div>
            <ScrollArea className={`${isToday ? "h-44" : "h-80"} rounded-md border`}>
              {loadingList ? (
                <div className="flex h-full items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : conversions.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No conversions recorded in this range.
                </div>
              ) : isMultiDay ? (
                <div className="divide-y">
                  {dayGroups.map((g) => (
                    <div key={g.dayId}>
                      <div className="flex items-center justify-between gap-2 bg-muted/50 px-3 py-1.5 text-xs">
                        <span className="font-semibold">{formatDayId(g.dayId)}</span>
                        <span className="text-muted-foreground"><NetSummary net={g.net} emptyText="—" /></span>
                      </div>
                      <ul className="divide-y">{g.entries.map(renderRow)}</ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="divide-y">{dayGroups[0]?.entries.map(renderRow)}</ul>
              )}
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Close
          </Button>
          {isToday && (
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record conversion
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
