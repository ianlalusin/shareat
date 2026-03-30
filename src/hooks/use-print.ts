'use client';

/**
 * use-print.ts
 * Centralized print hook — replaces handlePrint / handleThermalPrint
 * in every call site. Handles platform routing, formatting, audit write.
 *
 * Usage:
 *   const { printReceipt, isPrinting } = usePrint({
 *     receiptData, storeId, sessionId, appUser
 *   });
 */

import { useCallback, useState } from 'react';
import { doc, updateDoc, increment, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { getReceiptSettings } from '@/lib/receipts/receipt-settings';
import { formatReceiptText, formatPinText } from '@/lib/printing/receiptFormatter';
import {
  isNativeBluetoothAvailable,
  getLastPrinterAddress,
  printViaNativeBluetooth,
} from '@/lib/printing/printHub';
import type { AppUser } from '@/context/auth-context';
import type { ReceiptData } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

function getUsername(appUser: AppUser | null | undefined): string {
  return (
    appUser?.displayName?.trim() ||
    (appUser as any)?.name?.trim() ||
    (appUser?.email ? String(appUser.email).split('@')[0] : '') ||
    (appUser?.uid ? String(appUser.uid).slice(0, 6) : 'unknown')
  );
}

interface UsePrintOptions {
  receiptData: ReceiptData | null;
  storeId: string | null | undefined;
  sessionId?: string | null;
  appUser?: AppUser | null;
}

interface UsePrintReturn {
  printReceipt: () => Promise<void>;
  isPrinting: boolean;
  error: string | null;
}

export function usePrint({
  receiptData,
  storeId,
  sessionId,
  appUser,
}: UsePrintOptions): UsePrintReturn {
  const [isPrinting, setIsPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const writeAudit = useCallback(async () => {
    if (!storeId || !sessionId || sessionId === 'PREVIEW') return;
    try {
      await updateDoc(doc(db, 'stores', storeId, 'receipts', sessionId), {
        printedCount: increment(1),
        lastPrintedAt: serverTimestamp(),
        lastPrintedByUid: appUser?.uid ?? null,
        lastPrintedByUsername: appUser ? getUsername(appUser) : null,
      });
    } catch (e) {
      console.warn('Print audit tracking failed:', e);
    }
  }, [storeId, sessionId, appUser]);

  const printReceipt = useCallback(async () => {
    if (!receiptData || isPrinting) return;
    setIsPrinting(true);
    setError(null);

    try {
      if (isNativeBluetoothAvailable()) {
        const lastAddress = getLastPrinterAddress();
        if (!lastAddress) {
          toast({
            variant: 'destructive',
            title: 'No Printer',
            description: 'Go to Manager Tools → Printer Setup to connect a printer.',
          });
          return;
        }
        const liveSettings = storeId
          ? await getReceiptSettings(db, storeId)
          : receiptData.settings;
        const paperWidth: 58 | 80 = liveSettings.paperWidth === '58mm' ? 58 : 80;
        const text = formatReceiptText({ ...receiptData, settings: liveSettings }, paperWidth);
        await printViaNativeBluetooth({
          target: 'receipt',
          text,
          widthMm: paperWidth,
          cut: true,
          beep: true,
          encoding: 'CP437',
        });
        await writeAudit();
        toast({ title: 'Printed', description: 'Receipt sent to thermal printer.' });
      } else {
        await new Promise<void>(r =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        window.print();
        await writeAudit();
      }
    } catch (e: any) {
      const msg: string = e?.message ?? 'Unknown print error';
      setError(msg);
      toast({ variant: 'destructive', title: 'Print Failed', description: msg });
    } finally {
      setIsPrinting(false);
    }
  }, [receiptData, isPrinting, storeId, writeAudit, toast]);

  return { printReceipt, isPrinting, error };
}

// ─── PIN print ────────────────────────────────────────────────────────────────

export interface UsePinPrintOptions {
  pin: string | null;
  customerName?: string | null;
  storeName?: string;
  storeId?: string | null;
}

export interface UsePinPrintReturn {
  printPin: () => Promise<void>;
  isPrintingPin: boolean;
}

export function usePinPrint({
  pin,
  customerName,
  storeName,
  storeId,
}: UsePinPrintOptions): UsePinPrintReturn {
  const [isPrintingPin, setIsPrintingPin] = useState(false);
  const { toast } = useToast();

  const printPin = useCallback(async () => {
    if (!pin || isPrintingPin) return;
    setIsPrintingPin(true);

    try {
      if (isNativeBluetoothAvailable()) {
        const lastAddress = getLastPrinterAddress();
        if (!lastAddress) {
          toast({
            variant: 'destructive',
            title: 'No Printer',
            description: 'Go to Settings to connect a printer.',
          });
          return;
        }
        const liveSettings = storeId
          ? await getReceiptSettings(db, storeId)
          : null;
        const paperWidth: 58 | 80 = liveSettings?.paperWidth === '58mm' ? 58 : 80;
        const text = formatPinText({ pin, customerName, storeName, width: paperWidth });
        await printViaNativeBluetooth({
          target: 'pin',
          text,
          widthMm: paperWidth,
          cut: true,
          beep: false,
        });
        toast({ title: 'PIN Printed', description: 'PIN slip sent to thermal printer.' });
      } else {
        window.print();
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Print Failed', description: e?.message ?? 'Unknown error' });
    } finally {
      setIsPrintingPin(false);
    }
  }, [pin, isPrintingPin, storeId, customerName, storeName, toast]);

  return { printPin, isPrintingPin };
}
