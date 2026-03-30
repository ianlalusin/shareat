'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useStoreContext } from '@/context/store-context';
import { Loader2, Printer, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePinPrint } from '@/hooks/use-print';
import { QRCodeSVG } from 'qrcode.react';

export default function PrintPinPage() {
  const params = useParams<{ sessionId: string }>();
  const { sessionId } = params;
  const { activeStore } = useStoreContext();

  const [pin, setPin] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const { printPin, isPrintingPin } = usePinPrint({ pin, customerName, storeName: activeStore?.name, storeId: activeStore?.id });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paperSize, setPaperSize] = useState<"58mm" | "80mm">(() => {
    try {
      return (localStorage.getItem("receiptPaperWidth:global") as any) || "58mm";
    } catch {
      return "58mm";
    }
  });

  useEffect(() => {
    if (!activeStore?.id || !sessionId) {
      setIsLoading(false);
      if (!activeStore?.id) setError("Store not selected.");
      if (!sessionId) setError("Session ID is missing.");
      return;
    }

    const sessionRef = doc(db, 'stores', activeStore.id, 'activeSessions', sessionId);
    const unsubscribe = onSnapshot(
      sessionRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as any;
          setPin(data.customerPin || null);
          setCustomerName(data.customerName || data.customer?.name || null);
          setError(null);
        } else {
          setError("Active session not found. It may have been closed.");
          setPin(null);
          setCustomerName(null);
        }
        setIsLoading(false);
      },
      (err) => {
        console.error("Error fetching session for PIN print:", err);
        setError("Failed to load session data.");
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeStore?.id, sessionId]);

  useEffect(() => {
    if (pin && !isLoading && !error) {
      const timer = setTimeout(() => printPin(), 500);
      return () => clearTimeout(timer);
    }
  }, [pin, isLoading, error]);

  useEffect(() => {
    try { localStorage.setItem("receiptPaperWidth:global", paperSize); } catch {}
  }, [paperSize]);

  

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex justify-center items-center h-48">
          <Loader2 className="h-12 w-12 mx-auto my-4 animate-spin" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="my-4 text-destructive flex flex-col items-center gap-2 p-4">
          <WifiOff className="h-10 w-10" />
          <span>{error}</span>
        </div>
      );
    }

    if (!pin) {
      return (
        <div className="my-4 text-muted-foreground p-4 text-center">
          <p>No PIN issued for this session.</p>
        </div>
      );
    }

    const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    return (
      <div
        className={`receipt-view ${paperSize === "80mm" ? "receipt-80" : "receipt-58"} bg-white text-black p-2 text-center`}
        style={{ fontFamily: mono }}
      >
        <p className="text-xs leading-snug">
          Welcome {customerName || 'Valued Customer'},
        </p>

        <p className="text-xs leading-snug mt-2">
          We are glad you are here to
          <br />
          <b className="uppercase">SHARELEBRATE</b>
          <br />
          with us.
        </p>

        <p className="text-xs leading-snug mt-2">
          Scan the code below or go to
          <br />
          <b>customer.shareat.net</b>
          <br />
          then enter your PIN and enjoy our new refilling system.
        </p>

        <div className="my-3 flex flex-col items-center gap-2">
          <QRCodeSVG value="https://customer.shareat.net" size={paperSize === "80mm" ? 160 : 140} />
        </div>

        <div className="my-2">
          <div className="text-sm font-bold">PIN</div>
          <div className="text-2xl font-bold tracking-wider font-mono bg-zinc-100 px-3 py-2 rounded-lg inline-block min-w-[140px]">
            {pin}
          </div>
        </div>

        <p className="text-[10px] leading-snug mt-2">
          If you need any help please call the attention of our staff.
          <br />
          Have a nice stay!
        </p>

        <p className="text-[10px] mt-2 font-bold">
          - {activeStore?.name || 'The SharEat Team'}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 print:bg-white">
      <div id="receipt-print-root" data-paper={paperSize}>
        <div id="print-receipt-area">{renderContent()}</div>
      </div>

      <div className="mt-6 flex items-center gap-4 no-print">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Paper:</span>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={paperSize}
            onChange={(e) => setPaperSize(e.target.value as any)}
          >
            <option value="58mm">58mm</option>
            <option value="80mm">80mm</option>
          </select>
        </div>

        <Button variant="outline" onClick={() => window.history.back()}>
          Back
        </Button>

        <Button onClick={printPin} disabled={isLoading || !pin || isPrintingPin}>
          <Printer className="mr-2" /> Print
        </Button>
      </div>
    </div>
  );
}
