
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useStoreContext } from '@/context/store-context';
import { Loader2, Printer, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function PrintPinPage() {
    const params = useParams<{ sessionId: string }>();
    const { sessionId } = params;
    const { activeStore } = useStoreContext();

    const [pin, setPin] = useState<string | null>(null);
    const [customerName, setCustomerName] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!activeStore?.id || !sessionId) {
            setIsLoading(false);
            if (!activeStore?.id) setError("Store not selected.");
            if (!sessionId) setError("Session ID is missing.");
            return;
        }

        const sessionRef = doc(db, 'stores', activeStore.id, 'activeSessions', sessionId);
        const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setPin(data.customerPin || null);
                setCustomerName(data.customerName || data.customer?.name || null);
                setError(null);
            } else {
                setError("Active session not found. It may have been closed.");
                setPin(null);
                setCustomerName(null);
            }
            setIsLoading(false);
        }, (err) => {
            console.error("Error fetching session for PIN print:", err);
            setError("Failed to load session data.");
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [activeStore?.id, sessionId]);

    // Auto-print effect
    useEffect(() => {
        if (pin && !isLoading && !error) {
            const timer = setTimeout(() => {
                window.print();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [pin, isLoading, error]);

    const handlePrint = () => {
        window.print();
    };
    
    const renderContent = () => {
        if (isLoading) {
            return <div className="flex justify-center items-center h-48"><Loader2 className="h-12 w-12 mx-auto my-4 animate-spin" /></div>;
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

        return (
             <div className="receipt-view receipt-58 bg-white text-black p-2 text-center font-serif text-sm/relaxed">
                <p className="text-base">Welcome {customerName || 'Valued Customer'},</p>
                
                <p className="my-3">
                    We are glad you are here to
                    <br />
                    <b className="font-bold uppercase">SHARELEBRATE</b>
                    <br />
                    with us. To use this code, go to:
                </p>
                <p className="font-bold text-sm underline break-words">
                    customer.shareat<br/>.net
                </p>
                <p className="text-xs my-2">
                    then enter your pin:
                </p>

                <p className="text-xl font-bold font-mono tracking-wider my-2 bg-muted p-2 rounded-lg">
                    {pin}
                </p>

                <p className="text-xs my-2">
                    and enjoy our fast refilling system. If you need any help please call the attention of our staff. They will be more than happy to assist you.
                </p>
                <p className="mt-4">Have a nice stay!</p>
                <p className="mt-2 font-bold">- {activeStore?.name || 'The SharEat Team'}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 print:bg-white">
            <div id="receipt-print-root" data-paper="58mm">
              <div id="print-receipt-area">
                {renderContent()}
              </div>
            </div>
            
            <div className="mt-6 flex gap-4 no-print">
                <Button variant="outline" onClick={() => window.history.back()}>Back</Button>
                <Button onClick={handlePrint} disabled={isLoading || !pin}>
                    <Printer className="mr-2" /> Print
                </Button>
            </div>
        </div>
    );
}
