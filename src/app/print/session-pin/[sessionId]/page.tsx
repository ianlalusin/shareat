
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useStoreContext } from '@/context/store-context';
import { Loader2, Printer, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function PrintPinPage() {
    const params = useParams<{ sessionId: string }>();
    const { sessionId } = params;
    const { activeStore } = useStoreContext();

    const [pin, setPin] = useState<string | null>(null);
    const [sessionLabel, setSessionLabel] = useState<string | null>(null);
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
                setSessionLabel(data.sessionLabel || data.tableDisplayName || `Session ${sessionId.substring(0, 6)}`);
                setError(null);
            } else {
                setError("Active session not found. It may have been closed.");
                setPin(null);
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
            // Use a timeout to ensure the DOM has updated before printing
            const timer = setTimeout(() => {
                window.print();
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [pin, isLoading, error]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 print:bg-white">
            <style jsx global>{`
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    #print-area, #print-area * {
                        visibility: visible;
                    }
                    #print-area {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                        padding: 0;
                        margin: 0;
                    }
                    .no-print {
                        display: none;
                    }
                }
            `}</style>

            <div id="print-area" className="w-full max-w-xs mx-auto">
                <Card className="shadow-none border-none print:shadow-none print:border-none">
                    <CardHeader className="text-center">
                        <CardTitle className="text-xl">Customer Access PIN</CardTitle>
                        <CardDescription>{sessionLabel}</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <p className="text-sm text-muted-foreground">Your PIN is:</p>
                        {isLoading ? (
                            <Loader2 className="h-12 w-12 mx-auto my-4 animate-spin" />
                        ) : error ? (
                            <div className="my-4 text-destructive flex flex-col items-center gap-2">
                                <WifiOff className="h-10 w-10" />
                                <span>{error}</span>
                            </div>
                        ) : pin ? (
                            <p className="text-6xl font-bold font-mono tracking-widest my-4 bg-muted p-4 rounded-lg">
                                {pin}
                            </p>
                        ) : (
                            <div className="my-4 text-muted-foreground">
                                <p>No PIN issued for this session.</p>
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground">This PIN is valid for 3 hours.</p>
                    </CardContent>
                </Card>
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
