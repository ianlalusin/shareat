"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Receipt as ReceiptType } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { format } from "date-fns";

type Props = {
  open: boolean;
  voided: ReceiptType | null;
  /** Candidate replacement receipts (non-voided). */
  candidates: ReceiptType[];
  onOpenChange: (open: boolean) => void;
  onConfirm: (reRingReceiptId: string) => void | Promise<void>;
};

/**
 * Links a voided receipt to the new receipt that re-rang the same cash. Once
 * linked, the retained void cash is reversed out of expected remittance (the
 * re-ring's normal sale now accounts for that cash), preventing a double-count.
 */
export default function ReRingLinkModal({ open, voided, candidates, onOpenChange, onConfirm }: Props) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSearch("");
      setPicked(null);
      setSubmitting(false);
    }
  }, [open]);

  const retained = Number(voided?.voidCashRetained || 0);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates
      .filter((r) => r.status !== "voided" && r.id !== voided?.id)
      .filter((r) =>
        !q ||
        String(r.receiptNumber || "").toLowerCase().includes(q) ||
        String(r.customerName || "").toLowerCase().includes(q) ||
        String(r.tableNumber || "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [candidates, search, voided]);

  const handleConfirm = async () => {
    if (!picked) return;
    setSubmitting(true);
    try {
      await onConfirm(picked);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!submitting ? onOpenChange(o) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Re-ring</DialogTitle>
          <DialogDescription>
            Pick the receipt that re-rang this void&apos;s retained cash (₱{retained.toFixed(2)}). Linking reverses the
            retained cash from expected remittance so it isn&apos;t counted twice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input placeholder="Search by receipt #, customer, table…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-1">
            {list.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No matching receipts.</p>
            ) : (
              list.map((r) => {
                const when = toJsDate(r.createdAt);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setPicked(r.id)}
                    className={`flex w-full items-center justify-between rounded-md p-2 text-left text-sm transition ${
                      picked === r.id ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{r.receiptNumber || r.customerName || `Tbl ${r.tableNumber}`}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{when ? format(when, "p") : ""}</span>
                    </span>
                    <span className="font-mono">₱{Number(r.total || 0).toFixed(2)}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!picked || submitting} onClick={handleConfirm}>
            Link &amp; reverse retained cash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
