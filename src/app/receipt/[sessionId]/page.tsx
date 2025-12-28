
"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2, Printer, Info } from "lucide-react";
import { ReceiptView, ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";


export default function ReceiptPage() {
    const { sessionId } = useParams();
    const searchParams = useSearchParams();
    const { appUser } = useAuthContext();
    const { activeStoreId } = useStoreContext();
    const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    
    const hasAutoPrinted = useRef(false);
    const shouldAutoPrint = searchParams.get('autoprint') === '1';

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId || !activeStoreId || !appUser) {
                return;
            }

            try {
                const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStoreId, "sessions", sessionId as string)),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "billables"), orderBy("createdAt", "asc"))),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "payments"), orderBy("createdAt", "asc"))),
                    getDoc(doc(db, "stores", activeStoreId, "receiptSettings", "main"))
                ]);
                
                if (!sessionSnap.exists()) throw new Error("Session not found.");
                if (sessionSnap.data().storeId !== activeStoreId) throw new Error("You do not have permission to view this receipt.");
                
                setReceiptData({
                    session: sessionSnap.data() as any,
                    billables: billablesSnap.docs.map(d => d.data()) as any[],
                    payments: paymentsSnap.docs.map(d => d.data()) as any[],
                    settings: settingsSnap.exists() ? settingsSnap.data() as any : {},
                });

            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [sessionId, activeStoreId, appUser]);

    useEffect(() => {
        if (shouldAutoPrint && receiptData && !hasAutoPrinted.current) {
            hasAutoPrinted.current = true;
            window.print();
        }
    }, [shouldAutoPrint, receiptData]);

    const handlePrint = () => window.print();

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
            <div className="max-w-4xl mx-auto py-8 receipt-print-container">
                <div className="mb-4 space-y-4 no-print">
                    <div className="flex justify-end">
                        <Button onClick={handlePrint}><Printer className="mr-2"/> Print Receipt</Button>
                    </div>
                    <Accordion type="single" collapsible>
                      <AccordionItem value="item-1">
                        <AccordionTrigger>
                           <span className="flex items-center gap-2"><Info /> Printing Tips</span>
                        </AccordionTrigger>
                        <AccordionContent className="text-sm text-muted-foreground space-y-1">
                          <p>• For best results, use your browser's print dialog (Ctrl/Cmd + P).</p>
                          <p>• Set the **Paper Size** to match your printer (e.g., 80mm or 58mm).</p>
                          <p>• Ensure **Scale** is set to 100% or "Actual Size".</p>
                          <p>• Disable **Headers and Footers** in the print settings.</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                </div>
                {receiptData ? <ReceiptView data={receiptData} /> : <p>No receipt data found.</p>}
            </div>
        </RoleGuard>
    );
}
