"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query, updateDoc, serverTimestamp, increment, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import ReasonModal from "@/components/shared/ReasonModal";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2, Printer, Info } from "lucide-react";
import { ReceiptView } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { ModeOfPayment, Store, ReceiptData } from "@/lib/types";

function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

export default function ReceiptPage() {
    const params = useParams();
    const rawSessionId = params?.["sessionId"];
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    const searchParams = useSearchParams();
    const { appUser } = useAuthContext();
    const { activeStoreId, activeStore } = useStoreContext();
    const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm" | "A4">("80mm");
    const { toast } = useToast();
    const [paymentMethods, setPaymentMethods] = useState<ModeOfPayment[]>([]);

    const shouldAutoPrint = searchParams?.get("autoprint") === "1";
     const storageKey = useMemo(
        () => `receiptPaperWidth:${activeStore?.id ?? "nostore"}:${appUser?.uid ?? "nouser"}`,
        [activeStore?.id, appUser?.uid]
    );

    useEffect(() => {
        const storedWidth = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
        if (storedWidth === "58mm" || storedWidth === "80mm" || storedWidth === "A4") {
            setPaperWidth(storedWidth);
        } else if (receiptData?.settings?.paperWidth) {
            setPaperWidth(receiptData.settings.paperWidth);
        }
    }, [storageKey, receiptData]);


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
            if (!sessionId || !activeStoreId || !appUser || !activeStore) {
                return;
            }

            try {
                const [settingsSnap, receiptSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStoreId, "receiptSettings", "main")),
                    getDoc(doc(db, "stores", activeStoreId, "receipts", sessionId as string))
                ]);
                
                if (!receiptSnap.exists()) throw new Error("Receipt not found.");

                const receiptDocData = receiptSnap.data({ serverTimestamps: "estimate" }) as any;
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                
                // For preview, we can get most data from the receipt snapshot itself
                const sessionDataForPreview = {
                    id: receiptDocData.sessionId,
                    tableNumber: receiptDocData.tableNumber,
                    customerName: receiptDocData.customerName,
                    sessionMode: receiptDocData.sessionMode,
                    paymentSummary: receiptDocData.analytics,
                    closedAt: receiptDocData.createdAt,
                    startedByUid: "N/A", // This is not available in receipt, but can be added if needed
                    cashierName: receiptDocData.createdByUsername,
                };
                
                setReceiptData({
                    session: sessionDataForPreview as any,
                    lines: receiptDocData.lines || [],
                    payments: Object.entries(receiptDocData.analytics?.mop || {}).map(([key, value]) => ({ methodId: key, amount: value as number})),
                    settings: settingsData,
                    store: activeStore as Store,
                    receiptCreatedAt: receiptDocData.createdAt,
                    createdByUsername: receiptDocData.createdByUsername,
                    receiptNumber: receiptDocData.receiptNumber,
                    analytics: receiptDocData.analytics,
                });
                
                const storedWidth = localStorage.getItem(storageKey);
                if (storedWidth === "58mm" || storedWidth === "80mm" || storedWidth === "A4") {
                    setPaperWidth(storedWidth);
                } else if (settingsData.paperWidth) {
                    setPaperWidth(settingsData.paperWidth);
                }


            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [sessionId, activeStoreId, activeStore, appUser, storageKey]);

    const [isPrinting, setIsPrinting] = useState(false);

    const handlePrint = async () => {
        if (!receiptData || !activeStoreId || !appUser || !sessionId) return;
        if (isPrinting) return;
    
        setIsPrinting(true);
    
        window.requestAnimationFrame(async () => {
            window.print();
    
            if (sessionId !== "PREVIEW") {
                try {
                    const receiptRef = doc(db, `stores/${activeStoreId}/receipts`, sessionId);
                    await updateDoc(receiptRef, {
                        printedCount: increment(1),
                        lastPrintedAt: serverTimestamp(),
                        lastPrintedByUid: appUser.uid,
                        lastPrintedByUsername: getUsername(appUser),
                    });
                } catch (e) {
                    console.warn("Print audit tracking failed:", e);
                }
            }
    
            setIsPrinting(false);
        });
    };
    
    useEffect(() => {
        if (shouldAutoPrint && receiptData && !isLoading) {
            const printKey = `autoprint:${sessionId}`;
            if (sessionStorage.getItem(printKey) !== "1") {
                sessionStorage.setItem(printKey, "1");
                handlePrint();
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldAutoPrint, receiptData, isLoading, sessionId]);

    const handlePaperWidthChange = (value: "58mm" | "80mm" | "A4") => {
        setPaperWidth(value);
        localStorage.setItem(storageKey, value);
    };

    const widthClass = useMemo(() => {
        if (paperWidth === "58mm") return "receipt-58";
        if (paperWidth === "80mm") return "receipt-80";
        return "receipt-a4";
    }, [paperWidth]);

    if (isLoading) {
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

    const printedCount = receiptData?.analytics?.printedCount || 0;

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="flex flex-col items-center py-8 min-h-screen">
                <div className="w-full max-w-lg mb-4 space-y-4 no-print px-4">
                    <div className="flex justify-between items-center">
                        <div className="w-48">
                            <Select value={paperWidth} onValueChange={handlePaperWidthChange}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="58mm">58mm Thermal</SelectItem>
                                    <SelectItem value="80mm">80mm Thermal</SelectItem>
                                    <SelectItem value="A4">A4</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <Button onClick={handlePrint} disabled={!receiptData || isPrinting} className="w-32">
                             {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2"/>}
                             {printedCount > 0 ? 'Reprint' : 'Print'}
                        </Button>
                    </div>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="item-1">
                        <AccordionTrigger>
                           <span className="flex items-center gap-2"><Info /> Printing Tips</span>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground space-y-1">
                          <p>• In your browser's print dialog, set the **Paper Size** to match your selection (e.g., 80mm or 58mm).</p>
                          <p>• Ensure print **Scale** is set to 100% or "Actual Size".</p>
                          <p>• Disable **Headers and Footers** for a cleaner look.</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                </div>
                 <div id="print-receipt-area" className={widthClass}>
                    {receiptData ? <ReceiptView data={receiptData} paymentMethods={paymentMethods} forcePaperWidth={paperWidth} /> : <p>No receipt data found.</p>}
                </div>
            </div>
        </RoleGuard>
    );
}