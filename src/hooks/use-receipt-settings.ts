
'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase/client';
import { subscribeReceiptSettings, mergeReceiptSettings } from '@/lib/receipts/receipt-settings';
import type { ReceiptSettings } from '@/lib/types';

export function useReceiptSettings(storeId?: string | null) {
    const [settings, setSettings] = useState<ReceiptSettings>(() => mergeReceiptSettings(null));
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!storeId) {
            setSettings(mergeReceiptSettings(null));
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        
        const unsubscribe = subscribeReceiptSettings(db, storeId, 
            (newSettings) => {
                setSettings(newSettings);
                setIsLoading(false);
                setError(null);
            },
            (err) => {
                setError(err);
                setIsLoading(false);
                console.error("Failed to subscribe to receipt settings:", err);
            }
        );

        return () => unsubscribe();
        
    }, [storeId]);

    return { settings, isLoading, error };
}
