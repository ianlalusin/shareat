'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, increment, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Loader2, Printer, RotateCcw, X } from 'lucide-react';

import { db } from '@/lib/firebase/client';
import { useAuthContext } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchImageAsBase64, printPhotoViaNativeBluetooth } from '@/lib/printing/printHub';
import { ditherForThermal, printerDots } from '@/lib/printing/photoDither';
import { summarizePrints, type PhotoPrintRow } from '@/lib/photo-prints';
import { useConfirmDialog } from '@/components/global/confirm-dialog';

/**
 * Capture & Share photos guests sent to print (PIN page, "Photo prints" tab).
 *
 * The CUSTOMER app creates `stores/{storeId}/photoPrintRequests/{id}` (see its
 * capture-share-store.ts for the contract). Here the cashier prints, reprints a
 * bad print, or declines. Nothing touches the bill or daily sales (owner's
 * call, 2026-11-21): the small counter is the only record — the table's first
 * print counts as free, every other copy as an extra ₱20 collected by hand.
 */

/** Manila calendar day, "YYYY-MM-DD" — the same key the CUSTOMER app writes. */
export function manilaDayKey(ms = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
}

/** Today's requests, live. Used by the PIN page for the tab badge and by the panel. */
export function usePhotoPrintRequests(storeId: string | null | undefined): PhotoPrintRow[] | null {
  const [rows, setRows] = useState<PhotoPrintRow[] | null>(null);
  const [day, setDay] = useState(manilaDayKey());

  // Roll over at midnight without a reload.
  useEffect(() => {
    const t = setInterval(() => setDay(manilaDayKey()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!storeId) return;
    // Equality only, sorted here: no composite index needed.
    const q = query(collection(db, `stores/${storeId}/photoPrintRequests`), where('dayKey', '==', day));
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PhotoPrintRow, 'id'>) })).sort((a, b) => b.createdAtMs - a.createdAtMs)),
      () => setRows([]),
    );
  }, [storeId, day]);

  return rows;
}

const FOOTER = 'Thermal prints fade over time.\nKeep your digital copy!\n\n\n';

export function PhotoPrints({ storeId, rows }: { storeId: string; rows: PhotoPrintRow[] | null }) {
  const { user } = useAuthContext();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [paper, setPaper] = useState<58 | 80>(80);
  const { confirm, Dialog } = useConfirmDialog();
  const summary = useMemo(() => summarizePrints(rows ?? []), [rows]);

  useEffect(() => {
    getDoc(doc(db, `stores/${storeId}/receiptSettings`, 'main'))
      .then((s) => setPaper(s.data()?.paperWidth === '58mm' ? 58 : 80))
      .catch(() => {});
  }, [storeId]);

  const print = async (row: PhotoPrintRow, reprint: boolean) => {
    // An extra copy is ₱20, collected by hand (never added to the bill): make the cashier stop and collect first.
    if (!reprint && summary.kindById[row.id] === 'extra') {
      const ok = await confirm({
        title: `Collect ₱20 from ${row.tableDisplayName || 'the table'}`,
        description: "This table already used its free print. Collect ₱20 for this extra print, then print it. It is not added to the bill.",
        confirmText: 'Collected, print',
        cancelText: 'Not yet',
        destructive: false,
      });
      if (!ok) return;
    }
    setBusy(row.id);
    try {
      const jpeg = await fetchImageAsBase64(row.imageUrl);
      if (!jpeg) throw new Error('Could not download the photo. Check the internet connection.');
      const png = await ditherForThermal(jpeg, printerDots(paper));
      await printPhotoViaNativeBluetooth(png, paper, `${row.tableDisplayName || ''}\n${FOOTER}`);
      await updateDoc(doc(db, `stores/${storeId}/photoPrintRequests`, row.id), {
        status: 'printed',
        ...(reprint ? { reprintCount: increment(1) } : { printCount: increment(1) }),
        printedAtMs: row.printedAtMs || Date.now(),
        lastPrintedAtMs: Date.now(),
        printedByUid: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      toast({ title: reprint ? 'Reprinted' : 'Printed', description: `${row.tableDisplayName || 'Table'}: bring it to the table.` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Print failed', description: (e as Error)?.message || 'Try again.' });
    } finally {
      setBusy(null);
    }
  };

  const decline = async (row: PhotoPrintRow) => {
    setBusy(row.id);
    try {
      await updateDoc(doc(db, `stores/${storeId}/photoPrintRequests`, row.id), {
        status: 'declined',
        declinedByUid: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not decline', description: (e as Error)?.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {Dialog}
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Today: <b>{summary.copies}</b> printed · <b>{summary.free}</b> free · <b>{summary.extra}</b> extra
        {summary.extra ? ` (₱${summary.extra * 20} to collect)` : ''} · <b>{summary.reprints}</b> reprints · <b>{summary.waiting}</b> waiting
      </p>

      {rows === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No photo print requests today.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => {
            const kind = summary.kindById[r.id];
            return (
              <div key={r.id} className={`rounded-xl border bg-white p-3 ${r.status === 'queued' ? 'border-primary/50 ring-2 ring-primary/20' : 'opacity-80'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage link */}
                <img src={r.imageUrl} alt={`Photo from ${r.tableDisplayName || 'a table'}`} className="h-48 w-full rounded-lg bg-zinc-100 object-contain" loading="lazy" />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{r.tableDisplayName || 'Table'}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.customerName || 'Guest'} · {new Date(r.createdAtMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                  {r.status === 'declined' ? (
                    <Badge variant="outline">Declined</Badge>
                  ) : kind === 'free' ? (
                    <Badge variant="secondary">Free</Badge>
                  ) : (
                    <Badge className="bg-amber-500 text-white hover:bg-amber-500">Collect ₱20</Badge>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  {r.status === 'queued' && (
                    <>
                      <Button className="flex-1" disabled={busy === r.id} onClick={() => print(r, false)}>
                        {busy === r.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Printer className="mr-1 h-4 w-4" />}
                        Print
                      </Button>
                      <Button variant="outline" disabled={busy === r.id} onClick={() => decline(r)} aria-label="Decline this print">
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {r.status === 'printed' && (
                    <Button variant="outline" className="flex-1" disabled={busy === r.id} onClick={() => print(r, true)}>
                      {busy === r.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
                      Reprint (bad print)
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
