
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { StoreSettings, defaultStoreSettings, getStoreSettings } from '@/lib/settings';
import { ReceiptSettingsCard } from '@/components/admin/settings/receipt-settings-card';
import { BillingSettingsCard } from '@/components/admin/settings/billing-settings-card';
import { KitchenSettingsCard } from '@/components/admin/settings/kitchen-settings-card';
import { SecuritySettingsCard } from '@/components/admin/settings/security-settings-card';
import { ReportsSettingsCard } from '@/components/admin/settings/reports-settings-card';
import { UiSettingsCard } from '@/components/admin/settings/ui-settings-card';
import { RefillSettingsCard } from '@/components/admin/settings/refill-settings-card';


export default function SettingsPage() {
    const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
    const [receiptSettings, setReceiptSettings] = useState<any>({});
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const { selectedStoreId } = useStoreSelector();
    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();
    const { toast } = useToast();

    const fetchSettings = useCallback(async () => {
        if (!firestore || !selectedStoreId) {
            setSettings(defaultStoreSettings);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const fetchedSettings = await getStoreSettings(firestore, selectedStoreId);
            setSettings(fetchedSettings);
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error fetching settings',
                description: 'Could not load store settings. Using defaults.',
            });
            setSettings(defaultStoreSettings);
        } finally {
            setLoading(false);
        }
    }, [firestore, selectedStoreId, toast]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleSettingsChange = (category: keyof StoreSettings, newValues: any) => {
        setSettings(prev => ({
            ...prev,
            [category]: { ...prev[category], ...newValues },
        }));
    };
    
    const handlePinSettingsChange = (newValues: any) => {
        setSettings(prev => ({
            ...prev,
            security: {
                ...prev.security,
                requirePin: { ...prev.security.requirePin, ...newValues },
            }
        }));
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !selectedStoreId) return;

        setIsSaving(true);
        try {
            const settingsRef = doc(firestore, 'storeSettings', selectedStoreId);
            await setDoc(settingsRef, settings, { merge: true });
            openSuccessModal();
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Save Failed',
                description: 'Failed to save settings.',
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (!selectedStoreId) {
        return (
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <h1 className="text-lg font-semibold md:text-2xl font-headline">Settings</h1>
                <Alert variant="info">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store to configure its settings.</AlertDescription>
                </Alert>
            </main>
        );
    }
    
    if (loading) {
        return (
             <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-8 w-64 mb-4" />
                <div className="space-y-6">
                    <Skeleton className="h-[300px] w-full" />
                    <Skeleton className="h-[200px] w-full" />
                    <Skeleton className="h-[400px] w-full" />
                </div>
             </main>
        );
    }

    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold md:text-2xl font-headline">Store Settings</h1>
              <Button onClick={handleSubmit} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save All Settings'}
              </Button>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
                <ReceiptSettingsCard />
                <BillingSettingsCard settings={settings.billing} onUpdate={(v) => handleSettingsChange('billing', v)} />
                <KitchenSettingsCard settings={settings.kitchen} onUpdate={(v) => handleSettingsChange('kitchen', v)} />
                <RefillSettingsCard settings={settings.refill} onUpdate={(v) => handleSettingsChange('refill', v)} />
                <SecuritySettingsCard 
                    settings={settings.security} 
                    onGeneralUpdate={(v) => handleSettingsChange('security', v)}
                    onPinUpdate={handlePinSettingsChange}
                />
                <ReportsSettingsCard settings={settings.reports} onUpdate={(v) => handleSettingsChange('reports', v)} />
                <UiSettingsCard settings={settings.ui} onUpdate={(v) => handleSettingsChange('ui', v)} />
            </form>
        </main>
    );
}
