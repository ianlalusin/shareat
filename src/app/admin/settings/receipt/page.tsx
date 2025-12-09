

'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { ReceiptSettings, Store } from '@/lib/types';
import { useSuccessModal } from '@/store/use-success-modal';
import Image from 'next/image';
import { Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

const initialSettingsState: Omit<ReceiptSettings, 'id'> = {
    showLogo: true,
    receiptNumberPrefix: '',
    nextReceiptNumber: 1,
    showStoreAddress: true,
    showContactInfo: true,
    showTinNumber: false,
    footerNotes: '',
    printerType: 'thermal',
    paperWidth: '58mm',
};

const mockReceiptData = {
    items: [
        { name: 'Unli Pork & Beef', qty: 2, price: 549 },
        { name: 'Extra Mozzarella', qty: 1, price: 80 },
        { name: 'Coke Zero', qty: 2, price: 60 },
    ],
    cashierName: 'Jane Doe',
    date: new Date(),
};

function ReceiptPreview({ settings, store }: { settings: Omit<ReceiptSettings, 'id'>, store: Store | null }) {
    const subtotal = mockReceiptData.items.reduce((acc, item) => acc + (item.qty * item.price), 0);
    const vat = subtotal * 0.12;
    const total = subtotal;
    const receiptNumber = `${settings.receiptNumberPrefix}${String(settings.nextReceiptNumber).padStart(6, '0')}`;

    return (
        <div className="bg-white text-black p-4 rounded-lg shadow-lg w-full max-w-sm mx-auto">
            <div className={`font-mono text-xs w-full ${settings.paperWidth === '58mm' ? 'max-w-[250px]' : 'max-w-[350px]'} mx-auto`}>
                <div className="text-center space-y-1">
                    {settings.showLogo && store?.logo && (
                        <div className="flex justify-center mb-2">
                            <Image src={store.logo} alt="Store Logo" width={60} height={60} className="object-contain"/>
                        </div>
                    )}
                    <h2 className="text-sm font-bold">{store?.storeName || 'Your Store Name'}</h2>
                    {settings.showStoreAddress && <p>{store?.address || '123 Main St, Anytown'}</p>}
                    {settings.showContactInfo && <p>{store?.contactNo || '09123456789'}</p>}
                    {settings.showTinNumber && <p>TIN: {store?.tinNumber || '000-000-000-000'}</p>}
                </div>

                <div className="border-t border-dashed border-black my-2"></div>
                
                <div className="space-y-1">
                    <p>Receipt No: {receiptNumber}</p>
                    <p>Date: {format(mockReceiptData.date, 'MM/dd/yyyy hh:mm a')}</p>
                    <p>Cashier: {mockReceiptData.cashierName}</p>
                </div>

                <div className="border-t border-dashed border-black my-2"></div>
                
                <table className="w-full">
                    <thead>
                        <tr>
                            <th className="text-left font-normal">QTY</th>
                            <th className="text-left font-normal">ITEM</th>
                            <th className="text-right font-normal">TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {mockReceiptData.items.map((item, i) => (
                             <tr key={i}>
                                <td>{item.qty}</td>
                                <td>{item.name}</td>
                                <td className="text-right">{formatCurrency(item.qty * item.price)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                
                <div className="border-t border-dashed border-black my-2"></div>

                <div className="space-y-1">
                    <div className="flex justify-between"><p>Subtotal:</p><p>{formatCurrency(subtotal)}</p></div>
                    <div className="flex justify-between"><p>VAT (12%):</p><p>{formatCurrency(vat)}</p></div>
                    <div className="flex justify-between font-bold text-sm"><p>TOTAL:</p><p>{formatCurrency(total)}</p></div>
                </div>
                
                {settings.footerNotes && (
                    <>
                        <div className="border-t border-dashed border-black my-2"></div>
                        <p className="text-center">{settings.footerNotes}</p>
                    </>
                )}
                 <div className="border-t border-dashed border-black my-2"></div>
                 <p className="text-center text-[10px]">THIS IS NOT AN OFFICIAL RECEIPT</p>
            </div>
        </div>
    );
}

export default function ReceiptSettingsPage() {
    const [settings, setSettings] = useState<Omit<ReceiptSettings, 'id'>>(initialSettingsState);
    const [store, setStore] = useState<Store | null>(null);
    const [loading, setLoading] = useState(true);

    const { selectedStoreId } = useStoreSelector();
    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();
    const { toast } = useToast();

    useEffect(() => {
        if (!firestore || !selectedStoreId) {
            setLoading(false);
            setStore(null);
            setSettings(initialSettingsState);
            return;
        }

        setLoading(true);

        const settingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
        const settingsUnsubscribe = onSnapshot(settingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setSettings({ ...initialSettingsState, ...docSnap.data() });
            } else {
                setSettings(initialSettingsState);
            }
        });

        const storeRef = doc(firestore, 'stores', selectedStoreId);
        const storeUnsubscribe = onSnapshot(storeRef, (docSnap) => {
            if (docSnap.exists()) {
                setStore({ id: docSnap.id, ...docSnap.data() } as Store);
            } else {
                setStore(null);
            }
            setLoading(false);
        });

        return () => {
            settingsUnsubscribe();
            storeUnsubscribe();
        };
    }, [firestore, selectedStoreId]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        
        if (type === 'number') {
            setSettings(prev => ({ ...prev, [name]: value === '' ? '' : Number(value) }));
        } else {
            setSettings(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleSwitchChange = (name: keyof ReceiptSettings, checked: boolean) => {
        setSettings(prev => ({ ...prev, [name]: checked }));
    };

    const handleSelectChange = (name: keyof ReceiptSettings, value: string) => {
        setSettings(prev => ({...prev, [name]: value as any}));
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !selectedStoreId) return;

        try {
            const settingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
            await setDoc(settingsRef, settings, { merge: true });
            openSuccessModal();
        } catch (error) {
            console.error("Error saving settings:", error);
            toast({
                variant: 'destructive',
                title: 'Save Failed',
                description: 'Failed to save settings.'
            });
        }
    };

    if (!selectedStoreId) {
        return (
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <h1 className="text-lg font-semibold md:text-2xl font-headline">Receipt Settings</h1>
                <Alert variant="info">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store to configure its receipt settings.</AlertDescription>
                </Alert>
            </main>
        );
    }
    
    if (loading) {
        return (
             <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-8 w-64 mb-4" />
                <div className="grid md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                        <Card>
                            <CardHeader>
                                <Skeleton className="h-7 w-48" />
                                <Skeleton className="h-4 w-full mt-2" />
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <Skeleton className="h-24 w-full" />
                                <Skeleton className="h-24 w-full" />
                            </CardContent>
                        </Card>
                    </div>
                    <div className="md:col-span-1">
                         <Skeleton className="h-[500px] w-full" />
                    </div>
                </div>
             </main>
        )
    }

    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <h1 className="text-lg font-semibold md:text-2xl font-headline">Receipt Settings</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-8 items-start">
                <form onSubmit={handleSubmit} className="md:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>General Configuration</CardTitle>
                            <CardDescription>Customize the look and numbering of your receipts for {store?.storeName || 'the selected store'}.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-2">
                                <Label>Store Logo</Label>
                                <div className='flex items-center gap-4 p-4 border rounded-lg bg-muted/50'>
                                   <div className="h-16 w-16 flex-shrink-0 items-center justify-center rounded-md bg-muted overflow-hidden relative border">
                                        {store?.logo ? (
                                            <Image src={store.logo} alt="Store Logo" layout="fill" objectFit="cover" />
                                        ) : (
                                            <div className="flex h-full w-full items-center justify-center">
                                                <Receipt className="h-8 w-8 text-muted-foreground" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center space-x-2">
                                            <Switch id="showLogo" checked={settings.showLogo} onCheckedChange={(c) => handleSwitchChange('showLogo', c)} />
                                            <Label htmlFor="showLogo">Show on receipt</Label>
                                        </div>
                                        <p className="text-xs text-muted-foreground">This logo is managed from the main store settings.</p>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="receiptNumberPrefix">Receipt No. Prefix</Label>
                                    <Input id="receiptNumberPrefix" name="receiptNumberPrefix" value={settings.receiptNumberPrefix} onChange={handleInputChange} placeholder="e.g., LIPA-"/>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="nextReceiptNumber">Next Receipt Number</Label>
                                    <Input id="nextReceiptNumber" name="nextReceiptNumber" type="number" value={settings.nextReceiptNumber} onChange={handleInputChange} min="1"/>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <Label>Content Options</Label>
                                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                                    <div className="flex items-center space-x-2">
                                        <Switch id="showStoreAddress" checked={settings.showStoreAddress} onCheckedChange={(c) => handleSwitchChange('showStoreAddress', c)} />
                                        <Label htmlFor="showStoreAddress">Show Store Address</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch id="showContactInfo" checked={settings.showContactInfo} onCheckedChange={(c) => handleSwitchChange('showContactInfo', c)} />
                                        <Label htmlFor="showContactInfo">Show Contact Info</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <Switch id="showTinNumber" checked={settings.showTinNumber} onCheckedChange={(c) => handleSwitchChange('showTinNumber', c)} />
                                        <Label htmlFor="showTinNumber">Show TIN</Label>
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="footerNotes">Footer Notes</Label>
                                <Textarea id="footerNotes" name="footerNotes" value={settings.footerNotes} onChange={handleInputChange} placeholder="e.g., Thank you! Please come again." />
                            </div>
                        </CardContent>
                    </Card>
                    
                    <Card>
                        <CardHeader>
                            <CardTitle>Hardware Settings</CardTitle>
                            <CardDescription>Configure printer settings for your receipts.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="space-y-2">
                                    <Label htmlFor="printerType">Printer Type</Label>
                                    <Select name="printerType" value={settings.printerType} onValueChange={(v) => handleSelectChange('printerType', v)}>
                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="thermal">Thermal</SelectItem>
                                            <SelectItem value="standard">Standard</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="paperWidth">Paper Width</Label>
                                    <Select name="paperWidth" value={settings.paperWidth} onValueChange={(v) => handleSelectChange('paperWidth', v)}>
                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="58mm">58mm</SelectItem>
                                            <SelectItem value="80mm">80mm</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="flex justify-end mt-6">
                        <Button type="submit">Save Settings</Button>
                    </div>
                </form>

                <div className="md:col-span-1 lg:col-span-1">
                    <div className="sticky top-20">
                      <h3 className="text-lg font-semibold mb-2 font-headline">Receipt Preview</h3>
                      <ReceiptPreview settings={settings} store={store} />
                    </div>
                </div>
            </div>
        </main>
    );
}
