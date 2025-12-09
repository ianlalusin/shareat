
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useFirestore } from '@/firebase';
import { doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { StoreSettings, defaultStoreSettings, getStoreSettings } from '@/lib/settings';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import Image from 'next/image';
import { Receipt, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import type { ReceiptSettings, Store } from '@/lib/types';
import { useAuthContext } from '@/context/auth-context';


const mockReceiptData = {
    items: [
        { name: 'Unli Pork & Beef', qty: 2, price: 549 },
        { name: 'Extra Mozzarella', qty: 1, price: 80 },
        { name: 'Coke Zero', qty: 2, price: 60 },
    ],
    cashierName: 'Jane Doe',
    date: new Date(),
    customer: {
        name: 'Juan Dela Cruz',
        tin: '123-456-789-000',
        address: '123 Rizal Ave, Manila, Metro Manila'
    }
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

                {settings.showCustomerDetails && (
                     <>
                        <div className="space-y-1">
                           {mockReceiptData.customer.name && <p>Customer: {mockReceiptData.customer.name}</p>}
                           {mockReceiptData.customer.address && <p>Address: {mockReceiptData.customer.address}</p>}
                           {mockReceiptData.customer.tin && <p>TIN: {mockReceiptData.customer.tin}</p>}
                        </div>
                        <div className="border-t border-dashed border-black my-2"></div>
                     </>
                )}
                
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

const initialReceiptSettingsState: Omit<ReceiptSettings, 'id'> = {
    showLogo: true,
    receiptNumberPrefix: '',
    nextReceiptNumber: 1,
    showStoreAddress: true,
    showContactInfo: true,
    showTinNumber: false,
    showCustomerDetails: true,
    footerNotes: '',
    printerType: 'thermal',
    paperWidth: '58mm',
};

function ManagerGuard({ children }: { children: React.ReactNode }) {
    const { appUser, loading, devMode } = useAuthContext();
    const canAccess = devMode || appUser?.role === 'manager' || appUser?.role === 'admin' || appUser?.role === 'owner';

    if (loading) {
        return (
             <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <Skeleton className="h-8 w-64 mb-4" />
                <div className="space-y-6">
                    <Skeleton className="h-[300px] w-full" />
                </div>
             </main>
        );
    }
    
    if (!canAccess) {
        return (
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                 <h1 className="text-lg font-semibold md:text-2xl font-headline">Store Settings</h1>
                 <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <Ban className="h-12 w-12 text-destructive" />
                        <h3 className="text-2xl font-bold tracking-tight font-headline">Access Denied</h3>
                        <p className="text-sm text-muted-foreground">
                            You do not have permission to view or manage store settings.
                        </p>
                    </div>
                </div>
            </main>
        )
    }

    return <>{children}</>;
}


export default function SettingsPage() {
    const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
    const [receiptSettings, setReceiptSettings] = useState<Omit<ReceiptSettings, 'id'>>(initialReceiptSettingsState);
    const [store, setStore] = useState<Store | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const { selectedStoreId, setSelectedStoreId } = useStoreSelector();
    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();
    const { toast } = useToast();
    const { staff, appUser, devMode } = useAuthContext();
    
    // For managers, force the selected store to be their assigned store
    useEffect(() => {
        if (!devMode && appUser?.role === 'manager' && staff?.assignedStore) {
            const managerStore = stores.find(s => s.storeName === staff.assignedStore);
            if (managerStore && selectedStoreId !== managerStore.id) {
                setSelectedStoreId(managerStore.id);
            }
        }
    }, [appUser, staff, setSelectedStoreId, selectedStoreId, devMode]);
    
    const [stores, setStores] = useState<Store[]>([]);
     useEffect(() => {
        if (firestore) {
            const unsub = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
                setStores(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as Store));
            });
            return () => unsub();
        }
    }, [firestore]);


    const fetchSettings = useCallback(async () => {
        if (!firestore || !selectedStoreId) {
            setSettings(defaultStoreSettings);
            setReceiptSettings(initialReceiptSettingsState);
            setStore(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const fetchedSettings = await getStoreSettings(firestore, selectedStoreId);
            setSettings(fetchedSettings);
            
            const receiptSettingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
            const receiptSnap = await getDoc(receiptSettingsRef);
            if (receiptSnap.exists()) {
                setReceiptSettings({ ...initialReceiptSettingsState, ...receiptSnap.data() });
            } else {
                setReceiptSettings(initialReceiptSettingsState);
            }

            const storeRef = doc(firestore, 'stores', selectedStoreId);
            const storeSnap = await getDoc(storeRef);
            if(storeSnap.exists()){
                setStore({id: storeSnap.id, ...storeSnap.data()} as Store);
            }

        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error fetching settings',
                description: 'Could not load store settings. Using defaults.',
            });
            setSettings(defaultStoreSettings);
            setReceiptSettings(initialReceiptSettingsState);
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
    
    const handleReceiptInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        if (type === 'number') {
            setReceiptSettings(prev => ({ ...prev, [name]: value === '' ? 0 : Number(value) }));
        } else {
            setReceiptSettings(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleReceiptSwitchChange = (name: keyof ReceiptSettings, checked: boolean) => {
        setReceiptSettings(prev => ({ ...prev, [name]: checked }));
    };

    const handleReceiptSelectChange = (name: keyof ReceiptSettings, value: string) => {
        setReceiptSettings(prev => ({...prev, [name]: value as any}));
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !selectedStoreId) return;

        setIsSaving(true);
        try {
            const settingsRef = doc(firestore, 'storeSettings', selectedStoreId);
            await setDoc(settingsRef, settings, { merge: true });
            
            const receiptSettingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
            await setDoc(receiptSettingsRef, receiptSettings, { merge: true });

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
        <ManagerGuard>
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold md:text-2xl font-headline">Store Settings</h1>
                <Button onClick={handleSubmit} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save All Settings'}
                </Button>
                </div>
                
                <Accordion type="single" collapsible className="w-full space-y-4" defaultValue="item-1">
                    <AccordionItem value="item-1" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Receipt Settings</CardTitle>
                                <CardDescription className="mt-1">Customize the look and numbering of your receipts.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <CardContent>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                                        <div className="lg:col-span-2 space-y-6">
                                            {/* Receipt settings form content */}
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
                                                            <Switch id="showLogo" checked={receiptSettings.showLogo} onCheckedChange={(c) => handleReceiptSwitchChange('showLogo', c)} />
                                                            <Label htmlFor="showLogo">Show on receipt</Label>
                                                        </div>
                                                        <p className="text-xs text-muted-foreground">Logo is managed from the main store settings.</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                <div className="space-y-2">
                                                    <Label htmlFor="receiptNumberPrefix">Receipt No. Prefix</Label>
                                                    <Input id="receiptNumberPrefix" name="receiptNumberPrefix" value={receiptSettings.receiptNumberPrefix} onChange={handleReceiptInputChange} placeholder="e.g., LIPA-"/>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="nextReceiptNumber">Next Receipt Number</Label>
                                                    <Input id="nextReceiptNumber" name="nextReceiptNumber" type="number" value={receiptSettings.nextReceiptNumber} onChange={handleReceiptInputChange} min="1"/>
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <Label>Content Options</Label>
                                                <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                                                    <div className="flex items-center space-x-2">
                                                        <Switch id="showStoreAddress" checked={receiptSettings.showStoreAddress} onCheckedChange={(c) => handleReceiptSwitchChange('showStoreAddress', c)} />
                                                        <Label htmlFor="showStoreAddress">Show Store Address</Label>
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <Switch id="showContactInfo" checked={receiptSettings.showContactInfo} onCheckedChange={(c) => handleReceiptSwitchChange('showContactInfo', c)} />
                                                        <Label htmlFor="showContactInfo">Show Contact Info</Label>
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <Switch id="showTinNumber" checked={receiptSettings.showTinNumber} onCheckedChange={(c) => handleReceiptSwitchChange('showTinNumber', c)} />
                                                        <Label htmlFor="showTinNumber">Show Store TIN</Label>
                                                    </div>
                                                    <div className="flex items-center space-x-2">
                                                        <Switch id="showCustomerDetails" checked={receiptSettings.showCustomerDetails} onCheckedChange={(c) => handleReceiptSwitchChange('showCustomerDetails', c)} />
                                                        <Label htmlFor="showCustomerDetails">Show Customer Details</Label>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="footerNotes">Footer Notes</Label>
                                                <Textarea id="footerNotes" name="footerNotes" value={receiptSettings.footerNotes} onChange={handleReceiptInputChange} placeholder="e.g., Thank you! Please come again." />
                                            </div>
                                            <Separator />
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                                                <div className="space-y-2">
                                                    <Label htmlFor="printerType">Printer Type</Label>
                                                    <Select name="printerType" value={receiptSettings.printerType} onValueChange={(v) => handleReceiptSelectChange('printerType', v)}>
                                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="thermal">Thermal</SelectItem>
                                                            <SelectItem value="standard">Standard</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="paperWidth">Paper Width</Label>
                                                    <Select name="paperWidth" value={receiptSettings.paperWidth} onValueChange={(v) => handleReceiptSelectChange('paperWidth', v)}>
                                                        <SelectTrigger><SelectValue/></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="58mm">58mm</SelectItem>
                                                            <SelectItem value="80mm">80mm</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="lg:col-span-1">
                                            <div className="sticky top-20">
                                                <h3 className="text-base font-semibold mb-2 font-headline">Receipt Preview</h3>
                                                <ReceiptPreview settings={receiptSettings} store={store} />
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-2" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Billing Settings</CardTitle>
                                <CardDescription className="mt-1">Configure rules for billing, discounts, and rounding.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <CardContent className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        <div className="space-y-2">
                                            <Label htmlFor="maxDiscountWithoutManager">Max Cashier Discount (%)</Label>
                                            <Input 
                                                id="maxDiscountWithoutManager" 
                                                type="number"
                                                value={settings.billing.maxDiscountWithoutManager}
                                                onChange={(e) => handleSettingsChange('billing', { maxDiscountWithoutManager: Number(e.target.value) })}
                                            />
                                            <p className="text-xs text-muted-foreground">Max discount percentage a cashier can apply without manager PIN.</p>
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="roundingRule">Rounding Rule</Label>
                                            <Select 
                                                value={settings.billing.roundingRule}
                                                onValueChange={(value) => handleSettingsChange('billing', { roundingRule: value })}
                                            >
                                                <SelectTrigger><SelectValue/></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="none">No rounding</SelectItem>
                                                    <SelectItem value="0.25">Nearest 0.25</SelectItem>
                                                    <SelectItem value="0.50">Nearest 0.50</SelectItem>
                                                    <SelectItem value="1.00">Nearest 1.00</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">Rule for rounding the final bill total.</p>
                                        </div>
                                        <div className="flex items-center space-x-2 pt-6">
                                            <Switch 
                                                id="showCentavos" 
                                                checked={settings.billing.showCentavos}
                                                onCheckedChange={(checked) => handleSettingsChange('billing', { showCentavos: checked })}
                                            />
                                            <Label htmlFor="showCentavos">Show Centavos</Label>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-3" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Kitchen Display System (KDS) Settings</CardTitle>
                                <CardDescription className="mt-1">Customize the behavior and appearance of the kitchen display.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <CardContent className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
                                        <div className="space-y-2">
                                            <Label htmlFor="rushMinutes">Rush Time (minutes)</Label>
                                            <Input
                                                id="rushMinutes"
                                                type="number"
                                                value={settings.kitchen.rushMinutes}
                                                onChange={(e) => handleSettingsChange('kitchen', { rushMinutes: Number(e.target.value) })}
                                            />
                                            <p className="text-xs text-muted-foreground">An item is considered "RUSH" after this many minutes.</p>
                                        </div>
                                        <div className="space-y-4 pt-2">
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="highlightRush"
                                                    checked={settings.kitchen.highlightRush}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { highlightRush: c })}
                                                />
                                                <Label htmlFor="highlightRush">Highlight Rush Orders</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="showTableName"
                                                    checked={settings.kitchen.showTableName}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { showTableName: c })}
                                                />
                                                <Label htmlFor="showTableName">Show Table Name</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="showPackageName"
                                                    checked={settings.kitchen.showPackageName}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { showPackageName: c })}
                                                />
                                                <Label htmlFor="showPackageName">Show Package Name</Label>
                                            </div>
                                        </div>
                                        <div className="space-y-4 pt-2">
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="playSoundOnNewItem"
                                                    checked={settings.kitchen.playSoundOnNewItem}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { playSoundOnNewItem: c })}
                                                />
                                                <Label htmlFor="playSoundOnNewItem">Sound on New Item</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="playSoundForRushOnly"
                                                    checked={settings.kitchen.playSoundForRushOnly}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { playSoundForRushOnly: c })}
                                                    disabled={!settings.kitchen.playSoundOnNewItem}
                                                />
                                                <Label htmlFor="playSoundForRushOnly" className="text-muted-foreground">Sound for Rush Only</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="showHotNotifications"
                                                    checked={settings.kitchen.showHotNotifications}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { showHotNotifications: c })}
                                                />
                                                <Label htmlFor="showHotNotifications">Hot Station Notifications</Label>
                                            </div>
                                        </div>
                                        <div className="space-y-4 pt-2">
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="showRefillHistory"
                                                    checked={settings.kitchen.showRefillHistory}
                                                    onCheckedChange={(c) => handleSettingsChange('kitchen', { showRefillHistory: c })}
                                                />
                                                <Label htmlFor="showRefillHistory">Show Refill History</Label>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-4" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Refill Settings</CardTitle>
                                <CardDescription className="mt-1">Set rules and limits for customer refills.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                                <CardContent className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                                        <div className="space-y-2">
                                            <Label htmlFor="maxRefillPerItem">Max Refills Per Item</Label>
                                            <Input
                                                id="maxRefillPerItem"
                                                type="number"
                                                value={settings.refill.maxRefillPerItem ?? ''}
                                                onChange={(e) => handleSettingsChange('refill', { maxRefillPerItem: e.target.value === '' ? null : Number(e.target.value) })}
                                            />
                                            <p className="text-xs text-muted-foreground">Leave blank for no limit.</p>
                                        </div>
                                        <div className="space-y-4 pt-2">
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="allowAfterTimeLimit"
                                                    checked={settings.refill.allowAfterTimeLimit}
                                                    onCheckedChange={(c) => handleSettingsChange('refill', { allowAfterTimeLimit: c })}
                                                />
                                                <Label htmlFor="allowAfterTimeLimit">Allow Refill After Time Limit</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch
                                                    id="requireRushReason"
                                                    checked={settings.refill.requireRushReason}
                                                    onCheckedChange={(c) => handleSettingsChange('refill', { requireRushReason: c })}
                                                />
                                                <Label htmlFor="requireRushReason">Require Reason for Rush Refills</Label>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-5" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Security Settings</CardTitle>
                                <CardDescription className="mt-1">Manage PIN requirements and other security features.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                            <CardContent className="space-y-6">
                                    <div className="space-y-2 max-w-xs">
                                        <Label htmlFor="autoLogoutMinutes">Auto-logout Timer (minutes)</Label>
                                        <Input
                                            id="autoLogoutMinutes"
                                            type="number"
                                            value={settings.security.autoLogoutMinutes ?? ''}
                                            onChange={(e) => handleSettingsChange('security', { autoLogoutMinutes: e.target.value === '' ? null : Number(e.target.value) })}
                                        />
                                        <p className="text-xs text-muted-foreground">Automatically log out users after a period of inactivity. Set to 0 to disable.</p>
                                    </div>
                                    <Separator />
                                    <div>
                                        <h3 className="text-base font-medium mb-4">Require Manager PIN for:</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                                            <div className="flex items-center space-x-2">
                                                <Switch id="voidPayment" checked={settings.security.requirePin.voidPayment} onCheckedChange={(c) => handlePinSettingsChange({ voidPayment: c })} />
                                                <Label htmlFor="voidPayment">Voiding a Payment</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch id="cancelFinalizedBill" checked={settings.security.requirePin.cancelFinalizedBill} onCheckedChange={(c) => handlePinSettingsChange({ cancelFinalizedBill: c })} />
                                                <Label htmlFor="cancelFinalizedBill">Cancelling a Finalized Bill</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch id="cancelOrder" checked={settings.security.requirePin.cancelOrder} onCheckedChange={(c) => handlePinSettingsChange({ cancelOrder: c })} />
                                                <Label htmlFor="cancelOrder">Cancelling an Entire Order</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch id="cancelServedItem" checked={settings.security.requirePin.cancelServedItem} onCheckedChange={(c) => handlePinSettingsChange({ cancelServedItem: c })} />
                                                <Label htmlFor="cancelServedItem">Cancelling a Served Item</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch id="reprintReceipt" checked={settings.security.requirePin.reprintReceipt} onCheckedChange={(c) => handlePinSettingsChange({ reprintReceipt: c })} />
                                                <Label htmlFor="reprintReceipt">Reprinting a Receipt</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <Switch id="backdateOrder" checked={settings.security.requirePin.backdateOrder} onCheckedChange={(c) => handlePinSettingsChange({ backdateOrder: c })} />
                                                <Label htmlFor="backdateOrder">Backdating an Order</Label>
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="discountAbovePercent" className="text-sm">Discount above %</Label>
                                                <Input
                                                    id="discountAbovePercent"
                                                    type="number"
                                                    value={settings.security.requirePin.discountAbovePercent ?? ''}
                                                    onChange={(e) => handlePinSettingsChange({ discountAbovePercent: e.target.value === '' ? null : Number(e.target.value) })}
                                                    placeholder="e.g. 10"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-6" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>Reporting Settings</CardTitle>
                                <CardDescription className="mt-1">Control data visibility and content in generated reports.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                            <CardContent className="space-y-4">
                                    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id="includeCancelledOrders"
                                                checked={settings.reports.includeCancelledOrders}
                                                onCheckedChange={(c) => handleSettingsChange('reports', { includeCancelledOrders: c })}
                                            />
                                            <Label htmlFor="includeCancelledOrders">Include Cancelled Orders</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id="maskCustomerDetails"
                                                checked={settings.reports.maskCustomerDetails}
                                                onCheckedChange={(c) => handleSettingsChange('reports', { maskCustomerDetails: c })}
                                            />
                                            <Label htmlFor="maskCustomerDetails">Mask Customer Details</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <Switch
                                                id="showStaffName"
                                                checked={settings.reports.showStaffName}
                                                onCheckedChange={(c) => handleSettingsChange('reports', { showStaffName: c })}
                                            />
                                            <Label htmlFor="showStaffName">Show Staff Name in Reports</Label>
                                        </div>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                    
                    <AccordionItem value="item-7" className="border-0">
                        <Card>
                            <AccordionTrigger className="p-6 hover:no-underline">
                            <div className="flex-1 text-left">
                                <CardTitle>UI & Appearance Settings</CardTitle>
                                <CardDescription className="mt-1">Adjust the look and feel of the application.</CardDescription>
                            </div>
                            </AccordionTrigger>
                            <AccordionContent>
                            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label htmlFor="theme">Theme</Label>
                                        <Select
                                            value={settings.ui.theme}
                                            onValueChange={(value) => handleSettingsChange('ui', { theme: value })}
                                        >
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="system">System</SelectItem>
                                                <SelectItem value="light">Light</SelectItem>
                                                <SelectItem value="dark">Dark</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="cardSize">Card Size</Label>
                                        <Select
                                            value={settings.ui.cardSize}
                                            onValueChange={(value) => handleSettingsChange('ui', { cardSize: value })}
                                        >
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="compact">Compact</SelectItem>
                                                <SelectItem value="normal">Normal</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="cardDensity">Card Density</Label>
                                        <Select
                                            value={settings.ui.cardDensity}
                                            onValueChange={(value) => handleSettingsChange('ui', { cardDensity: value })}
                                        >
                                            <SelectTrigger><SelectValue/></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="comfortable">Comfortable</SelectItem>
                                                <SelectItem value="compact">Compact</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </CardContent>
                            </AccordionContent>
                        </Card>
                    </AccordionItem>
                </Accordion>
            </main>
        </ManagerGuard>
    );
}
