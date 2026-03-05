
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query, updateDoc, serverTimestamp, increment, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2, Printer, Info, Bluetooth } from "lucide-react";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { ModeOfPayment, Store, ReceiptData, ReceiptSettings } from "@/lib/types";
import { formatReceiptText } from "@/lib/printing/receiptFormatter";
import { printViaNativeBluetooth, getLastPrinterAddress } from "@/lib/printing/printHub";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import { getReceiptSettings } from "@/lib/receipts/receipt-settings";
import { Capacitor } from "@capacitor/core";

type StrippedReceiptData = Omit<ReceiptData, 'settings'>;

function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

export default function ReceiptPage() {
    const params = useParams<{ sessionId?: string }>();
    const sessionIdParam = params?.sessionId;
    const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
    
    const searchParams = useSearchParams();
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const activeStoreId = activeStore?.id ?? null;

    const { settings: receiptSettings, isLoading: settingsLoading } = useReceiptSettings(activeStoreId);

    const [receiptData, setReceiptData] = useState<StrippedReceiptData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
    const [isThermalPrinting, setIsThermalPrinting] = useState(false);
    const { toast } = useToast();
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);

    const shouldAutoPrint = searchParams?.get("autoprint") === "1";
     const storageKey = useMemo(
        () => `receiptPaperWidth:${activeStore?.id ?? "nostore"}:${appUser?.uid ?? "nouser"}`,
        [activeStore?.id, appUser?.uid]
    );

    useEffect(() => {
        const storedWidth = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
        if (storedWidth === "58mm" || storedWidth === "80mm") {
            setPaperWidth(storedWidth);
        } else if (receiptSettings?.paperWidth) {
            const paperSetting = receiptSettings.paperWidth as "58mm" | "80mm";
             if (paperSetting === '58mm' || paperSetting === '80mm') {
                setPaperWidth(paperSetting);
            }
        }
    }, [storageKey, receiptSettings]);


    useEffect(() => {
        if (!activeStoreId) return;

        const mopRef = collection(db, "stores", activeStoreId, "storeModesOfPayment");
        const mopQuery = query(
            mopRef, 
            where("isArchived", "==", false),
            orderBy("sortOrder", "asc")
        );
        const unsubscribe = onSnapshot(mopQuery, (snapshot) => {
            setPaymentMethods(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment)));
        });

        return () => unsubscribe();
    }, [activeStoreId]);

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId || !activeStoreId || !activeStore) {
                return;
            }

            try {
                const receiptSnap = await getDoc(doc(db, "stores", activeStoreId, "receipts", sessionId as string));
                
                if (!receiptSnap.exists()) throw new Error("Receipt not found.");

                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                
                const sessionDataForPreview = {
                    id: receiptDocData.sessionId,
                    tableNumber: receiptDocData.tableNumber,
                    customerName: receiptDocData.customerName,
                    sessionMode: receiptDocData.sessionMode,
                    paymentSummary: receiptDocData.analytics,
                    closedAt: receiptDocData.createdAt,
                    startedByUid: "N/A",
                    cashierName: receiptDocData.createdByUsername,
                };
                
                setReceiptData({
                    session: sessionDataForPreview as any,
                    lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number})),
                    store: activeStore as Store,
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                });
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [sessionId, activeStoreId, activeStore, storageKey]);

    const [isPrinting, setIsPrinting] = useState(false);

    const handlePrint = async () => {
        if (!receiptData || !activeStoreId || !sessionId || settingsLoading) return;
        if (isPrinting) return;
    
        setIsPrinting(true);
    
        // Ensure layout has applied paperWidth before printing
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        window.print();
    
        if (sessionId !== "PREVIEW") {
            try {
                const receiptRef = doc(db, "stores", activeStoreId, "receipts", sessionId);
                const uid = appUser?.uid ?? null;
                const username = appUser ? getUsername(appUser) : null;

                await updateDoc(receiptRef, {
                    printedCount: increment(1),
                    lastPrintedAt: serverTimestamp(),
                    lastPrintedByUid: uid,
                    lastPrintedByUsername: username,
                });
            } catch (e) {
                console.warn("Print audit tracking failed:", e);
            }
        }
    
        setIsPrinting(false);
    };

    const handleThermalPrint = async () => {
        if (!receiptData || isThermalPrinting || !activeStoreId || !sessionId) return;
        
        setIsThermalPrinting(true);
        try {
            const lastAddress = getLastPrinterAddress();
            if (!lastAddress) {
                toast({ variant: 'destructive', title: 'No Printer', description: 'Configure thermal printer in Manager Tools.' });
                setIsThermalPrinting(false);
                return;
            }

            // Always fetch latest settings for thermal printing
            const liveSettings = await getReceiptSettings(db, activeStoreId);
            const paperWidth = liveSettings.paperWidth === "58mm" ? 58 : 80;
            const text = formatReceiptText({ ...receiptData, settings: liveSettings }, paperWidth);

            await printViaNativeBluetooth({ target: 'receipt', text, widthMm: paperWidth, cut: true, beep: true, encoding: 'CP437' });

            if (sessionId !== "PREVIEW") {
                const receiptRef = doc(db, "stores", activeStoreId, "receipts", sessionId);
                const uid = appUser?.uid ?? null;
                const username = appUser ? getUsername(appUser) : null;

                await updateDoc(receiptRef, {
                    printedCount: increment(1),
                    lastPrintedAt: serverTimestamp(),
                    lastPrintedByUid: uid,
                    lastPrintedByUsername: username,
                });
            }
            toast({ title: 'Success', description: 'Sent to thermal printer.' });
        } catch (e: any) {
            toast({ variant: 'destructive', title: 'Print Failed', description: e.message });
        } finally {
            setIsThermalPrinting(false);
        }
    };
    
    useEffect(() => {
        if (shouldAutoPrint && receiptData && !isLoading && !settingsLoading) {
            const printKey = `autoprint:${sessionId}`;
            if (sessionStorage.getItem(printKey) !== "1") {
                sessionStorage.setItem(printKey, "1");
                handlePrint();
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldAutoPrint, receiptData, isLoading, settingsLoading, sessionId]);

    const handlePaperWidthChange = (value: "58mm" | "80mm") => {
        setPaperWidth(value);
        localStorage.setItem(storageKey, value);
    };
    
    if (isLoading || settingsLoading) {
        return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin h-10 w-10" /></div>;
    }

    if (error) {
        return (
             <div className="flex items-center justify-center h-screen">
                <Alert variant="destructive" className="max-w-md">
                    <AlertTitle>Error Loading Receipt</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            </div>
        )
    }
    
    const printedCount = (receiptData?.analytics as any)?.printedCount || 0;

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="flex flex-col items-center py-8 min-h-screen print:py-0 print:items-start print:block">
                <div className="w-full max-w-lg mb-4 space-y-4 no-print px-4">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
                        <div className="w-full sm:w-48">
                            <Select value={paperWidth} onValueChange={handlePaperWidthChange}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="58mm">58mm Thermal</SelectItem>
                                    <SelectItem value="80mm">80mm Thermal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button variant="outline" onClick={handleThermalPrint} disabled={!receiptData || isThermalPrinting || !Capacitor.isNativePlatform()} className="flex-1 sm:flex-none">
                                {isThermalPrinting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bluetooth className="mr-2 h-4 w-4"/>}
                                {Capacitor.isNativePlatform() ? 'Native Print' : 'Native Print (Android only)'}
                            </Button>
                            <Button onClick={handlePrint} disabled={!receiptData || isPrinting || settingsLoading} className="flex-1 sm:flex-none">
                                {isPrinting || settingsLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4"/>}
                                {printedCount > 0 ? 'Reprint' : 'Print'}
                            </Button>
                        </div>
                    </div>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="item-1">
                        <AccordionTrigger>
                           <span className="flex items-center gap-2"><Info /> Printing Tips</span>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground space-y-1">
                          <p>• <b>Native Print</b> works only in the Android app build (Bluetooth thermal printers).</p>
                          <p>• For <b>Standard Print</b>, ensure print <b>Scale</b> is set to 100% or "Actual Size".</p>
                          <p>• Disable <b>Headers and Footers</b> in the browser print dialog.</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                </div>
                <div 
                    id="receipt-print-root" 
                    data-paper={paperWidth}
                >
                    <div id="print-receipt-area">
                        {receiptData && receiptSettings && <ReceiptView data={{...receiptData, settings: receiptSettings}} paymentMethods={paymentMethods} />}
                    </div>
                </div>
            </div>
        </RoleGuard>
    );
}

    