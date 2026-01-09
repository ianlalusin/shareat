
'use client';

import { useState, useEffect, useMemo } from 'react';
import { RoleGuard } from '@/components/guards/RoleGuard';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertCircle, Loader, Trash2 } from 'lucide-react';
import { useStoreContext } from '@/context/store-context';
import { collection, getDocs, query } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { clearStoreData } from '@/lib/firebase/admin-delete';
import { useToast } from '@/hooks/use-toast';
import type { Store } from '@/lib/types';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ResetDataPage() {
    const { allowedStores } = useStoreContext();
    const { toast } = useToast();
    const [selectedStoreId, setSelectedStoreId] = useState<string>('');
    const [counts, setCounts] = useState<{ sessions: number; receipts: number } | null>(null);
    const [isLoadingCounts, setIsLoadingCounts] = useState(false);
    const [confirmationText, setConfirmationText] = useState('');
    const [resetCounter, setResetCounter] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const [progressLog, setProgressLog] = useState<string[]>([]);

    const selectedStore = useMemo(() => allowedStores.find(s => s.id === selectedStoreId), [allowedStores, selectedStoreId]);

    useEffect(() => {
        if (!selectedStoreId) {
            setCounts(null);
            return;
        }
        
        setIsLoadingCounts(true);
        const fetchCounts = async () => {
            try {
                const sessionsQuery = query(collection(db, 'stores', selectedStoreId, 'sessions'));
                const receiptsQuery = query(collection(db, 'stores', selectedStoreId, 'receipts'));
                
                const [sessionsSnap, receiptsSnap] = await Promise.all([
                    getDocs(sessionsQuery),
                    getDocs(receiptsQuery),
                ]);

                setCounts({
                    sessions: sessionsSnap.size,
                    receipts: receiptsSnap.size,
                });
            } catch (error: any) {
                toast({ variant: 'destructive', title: 'Error fetching counts', description: error.message });
            } finally {
                setIsLoadingCounts(false);
            }
        };

        fetchCounts();
    }, [selectedStoreId, toast]);

    const confirmationPhrase = useMemo(() => {
        if (!selectedStore?.code) return '';
        return `${selectedStore.code} DELETE ALL SESSIONS`;
    }, [selectedStore]);

    const isConfirmationMatch = confirmationText === confirmationPhrase;

    const handleResetData = async () => {
        if (!isConfirmationMatch || !selectedStoreId) return;

        setIsDeleting(true);
        setProgressLog([]);

        try {
            await clearStoreData(selectedStoreId, resetCounter, (message) => {
                setProgressLog(prev => [...prev, message]);
            });
            toast({ title: 'Data Reset Complete', description: `All session and receipt data for ${selectedStore?.name} has been deleted.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Deletion Failed', description: error.message });
        } finally {
            setIsDeleting(false);
            setConfirmationText('');
             // Refetch counts after deletion
            const sessionsQuery = query(collection(db, 'stores', selectedStoreId, 'sessions'));
            const receiptsQuery = query(collection(db, 'stores', selectedStoreId, 'receipts'));
            const [sessionsSnap, receiptsSnap] = await Promise.all([getDocs(sessionsQuery), getDocs(receiptsQuery)]);
            setCounts({ sessions: sessionsSnap.size, receipts: receiptsSnap.size });
        }
    };

    return (
        <RoleGuard allow={['admin']}>
            <PageHeader title="Data Reset Tool" description="Permanently delete session and receipt data for a store." />
            <Card className="max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle>Select Store</CardTitle>
                    <CardDescription>Choose the store you want to clear data from. This action is irreversible.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <Select value={selectedStoreId} onValueChange={setSelectedStoreId} disabled={isDeleting}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a store..." />
                        </SelectTrigger>
                        <SelectContent>
                            {allowedStores.map(store => (
                                <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {selectedStore && (
                        <>
                            <Card>
                                <CardHeader>
                                    <CardTitle>Data to be Deleted</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {isLoadingCounts ? <Loader className="animate-spin"/> : (
                                        <div className="space-y-2 text-sm">
                                            <div className="flex justify-between"><span>Session Records:</span> <strong>{counts?.sessions ?? 0}</strong></div>
                                            <div className="flex justify-between"><span>Receipt Records:</span> <strong>{counts?.receipts ?? 0}</strong></div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Warning: Irreversible Action</AlertTitle>
                                <AlertDescription>
                                    This will permanently delete all session and receipt history, including kitchen tickets, payments, and activity logs for <strong>{selectedStore.name}</strong>.
                                </AlertDescription>
                            </Alert>

                             <div className="space-y-2">
                                <Label>To confirm, type: <strong className="text-destructive font-mono">{confirmationPhrase}</strong></Label>
                                <Input 
                                    value={confirmationText}
                                    onChange={e => setConfirmationText(e.target.value)}
                                    disabled={isDeleting}
                                />
                             </div>
                             <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="reset-counter" 
                                    checked={resetCounter} 
                                    onCheckedChange={c => setResetCounter(c as boolean)}
                                    disabled={isDeleting}
                                />
                                <Label htmlFor="reset-counter">Reset receipt counter to 0</Label>
                            </div>
                            
                            {isDeleting && (
                                <Card>
                                    <CardHeader><CardTitle>Deletion in Progress...</CardTitle></CardHeader>
                                    <CardContent>
                                        <ScrollArea className="h-40 w-full rounded-md border p-4">
                                            <div className="text-sm font-mono whitespace-pre-wrap">
                                                {progressLog.join('\n')}
                                            </div>
                                        </ScrollArea>
                                    </CardContent>
                                </Card>
                            )}

                            <Button 
                                variant="destructive" 
                                className="w-full"
                                disabled={!isConfirmationMatch || isDeleting}
                                onClick={handleResetData}
                            >
                                {isDeleting ? <Loader className="animate-spin"/> : <Trash2 className="mr-2"/>}
                                Delete Data for {selectedStore.code}
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>
        </RoleGuard>
    );
}
