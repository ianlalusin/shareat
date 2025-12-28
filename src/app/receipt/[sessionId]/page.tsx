
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc, collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Loader2, Printer } from "lucide-react";
import { ReceiptView, ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";

export default function ReceiptPage() {
    const { sessionId } = useParams();
    const { appUser } = useAuthContext();
    const { activeStoreId } = useStoreContext();
    const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            if (!sessionId || !activeStoreId || !appUser) {
                return;
            }

            try {
                // Fetch all data in parallel
                const [sessionSnap, billablesSnap, paymentsSnap, settingsSnap] = await Promise.all([
                    getDoc(doc(db, "stores", activeStoreId, "sessions", sessionId as string)),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "billables"), orderBy("createdAt", "asc"))),
                    getDocs(query(collection(db, "stores", activeStoreId, "sessions", sessionId as string, "payments"), orderBy("createdAt", "asc"))),
                    getDoc(doc(db, "stores", activeStoreId, "receiptSettings", "main"))
                ]);
                
                if (!sessionSnap.exists()) {
                    throw new Error("Session not found.");
                }

                // Basic authorization check
                if (sessionSnap.data().storeId !== activeStoreId) {
                     throw new Error("You do not have permission to view this receipt.");
                }
                
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

    const handlePrint = () => {
        window.print();
    };

    if (isLoading) {
        return <div className="flex items-center justify-center h-screen"><Loader2 className="animate-spin h-10 w-10" /></div>;
    }

    if (error) {
        return <div className="flex items-center justify-center h-screen text-red-500">{error}</div>;
    }

    return (
        <RoleGuard allow={["admin", "manager", "cashier"]}>
            <div className="max-w-4xl mx-auto py-8">
                <div className="flex justify-end mb-4 print:hidden">
                    <Button onClick={handlePrint}><Printer className="mr-2"/> Print Receipt</Button>
                </div>
                {receiptData ? <ReceiptView data={receiptData} /> : <p>No receipt data found.</p>}
            </div>
        </RoleGuard>
    );
}
