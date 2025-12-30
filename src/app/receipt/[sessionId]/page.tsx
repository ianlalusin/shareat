
"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query, updateDoc, serverTimestamp, increment } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2, Printer, Info } from "lucide-react";
import { ReceiptView, ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

function getUsername(appUser: any) {
  return (appUser?.displayName?.trim())
    || (appUser?.name?.trim())
    || (appUser?.email ? String(appUser.email).split("@")[0] : "")
    || (appUser?.uid ? String(appUser.uid).slice(0,6) : "unknown");
}

export default function ReceiptPage() {
    const { sessionId } = useParams();
    const searchParams = useSearchParams();
    const { appUser } = useAuthContext();
    const { activeStoreId } = useStoreContext();
    const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm" | "A4">("80mm");
    const { toast } = useToast();
    
    const hasAutoPrinted = useRef(false);
    const shouldAutoPrint = searchParams.get('autoprint') === '1';

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId || !activeStoreId || !appUser) {
                return;
            }

            try {
                const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap, receiptSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStoreId, "sessions", sessionId as string)),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "billables"), orderBy("createdAt", "asc"))),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "payments"), orderBy("createdAt", "asc"))),
                    getDoc(doc(db, "stores", activeStoreId, "receiptSettings", "main")),
                    getDoc(doc(db, "stores", activeStoreId, "receipts", sessionId as string))
                ]);
                
                if (!sessionSnap.exists()) throw new Error("Session not found.");

                const sessionData = sessionSnap.data({ serverTimestamps: "estimate" }) as any;
                if (sessionData.storeId !== activeStoreId) throw new Error("You do not have permission to view this receipt.");
                
                const settingsData = settingsSnap.exists() ? settingsSnap.data() as any : {};
                
                const receiptDocData = receiptSnap.exists()
                    ? (receiptSnap.data({ serverTimestamps: "estimate" }) as any)
                    : null;
                    
                const receiptCreatedAt =
                    receiptDocData?.createdAt ?? receiptSnap.createTime ?? sessionSnap.updateTime ?? null;
                    
                // Fetch server name if needed
                let serverName = null;
                if (sessionData.verifiedByUid) {
                    const serverDoc = await getDoc(doc(db, "users", sessionData.verifiedByUid));
                    if (serverDoc.exists()) {
                        serverName = serverDoc.data().name || sessionData.verifiedByUid.substring(0, 6);
                    }
                }
                
                // Use denormalized cashier name from receipt, fallback to session, then UID
                const cashierName = receiptDocData?.createdByUsername || sessionData.startedByName || sessionData.startedByUid.substring(0, 6);


                setReceiptData({
                    session: { 
                        ...sessionData, 
                        closedAt: sessionData?.closedAt ?? sessionSnap.updateTime,
                        cashierName,
                        serverName,
                    } as any,
                    billables: billablesSnap.docs.map(d => d.data()) as any[],
                    payments: paymentsSnap.docs.map(d => d.data()) as any[],
                    settings: settingsData,
                    receiptCreatedAt: receiptCreatedAt,
                });
                setPaperWidth(settingsData.paperWidth || "80mm");

            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [sessionId, activeStoreId, appUser]);

    useEffect(() => {
        if (shouldAutoPrint && receiptData && !isLoading && !hasAutoPrinted.current) {
            hasAutoPrinted.current = true;
            handlePrint(receiptData);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shouldAutoPrint, receiptData, isLoading]);

    const [isPrinting, setIsPrinting] = useState(false);

    const handlePrint = async (data: ReceiptData | null) => {
      if (!data || !activeStoreId) return;
      if (isPrinting) return;

      setIsPrinting(true);
      try {

        // Only track prints for REAL receipts (not live preview)
        if (data.session?.id && data.session.id !== "PREVIEW" && appUser?.uid) {
          try {
            const receiptRef = doc(db, `stores/${activeStoreId}/receipts`, data.session.id);
            await updateDoc(receiptRef, {
              printedCount: increment(1),
              lastPrintedAt: serverTimestamp(),
              lastPrintedByUid: appUser.uid,
              lastPrintedByUsername: getUsername(appUser),
            });
          } catch (e) {
            console.warn("Print tracking failed", e);
            toast({ variant: "destructive", title: "Print tracking failed", description: "Printing will continue, but audit fields were not saved." });
          }
        }

        setTimeout(() => window.print(), 100);
      } finally {
        setIsPrinting(false);
      }
    };

    const handlePaperWidthChange = async (value: "58mm" | "80mm" | "A4") => {
        setPaperWidth(value);
        
        // Only managers and admins can persist this setting
        if (appUser?.role === 'admin' || appUser?.role === 'manager') {
            if (!activeStoreId) return;
            try {
                const settingsRef = doc(db, `stores/${activeStoreId}/receiptSettings`, "main");
                await updateDoc(settingsRef, { paperWidth: value, updatedAt: serverTimestamp() });
                toast({ title: "Paper Width Saved", description: `Default paper size set to ${value}.` });
            } catch (error: any) {
                 toast({ variant: "destructive", title: "Save Failed", description: error.message });
            }
        }
    };

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

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="max-w-4xl mx-auto py-8">
                <div className="mb-4 space-y-4 no-print">
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
                        <Button onClick={() => handlePrint(receiptData)} disabled={isPrinting}>
                             {isPrinting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Printing...</> : <><Printer className="mr-2"/> Print Receipt</>}
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
                 <div className="receipt-print-container">
                    {receiptData ? <ReceiptView data={receiptData} forcePaperWidth={paperWidth} /> : <p>No receipt data found.</p>}
                </div>
            </div>
        </RoleGuard>
    );
}
