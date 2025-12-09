
'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReceiptSettings, Store } from '@/lib/types';
import Image from 'next/image';
import { Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';

const initialSettingsState: Omit<ReceiptSettings, 'id'> = {
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

export function ReceiptSettingsCard() {
    const [settings, setSettings] = useState<Omit<ReceiptSettings, 'id'>>(initialSettingsState);
    const [store, setStore] = useState<Store | null>(null);
    const [loading, setLoading] = useState(true);

    const { selectedStoreId } = useStoreSelector();
    const firestore = useFirestore();
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
            setSettings(prev => ({ ...prev, [name]: value === '' ? 0 : Number(value) }));
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

    return (
        <Card>
            <CardHeader>
                <CardTitle>Receipt Settings</CardTitle>
                <CardDescription>Customize the look and numbering of your receipts.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                    <div className="lg:col-span-2 space-y-6">
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
                                    <p className="text-xs text-muted-foreground">Logo is managed from the main store settings.</p>
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
                                    <Label htmlFor="showTinNumber">Show Store TIN</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Switch id="showCustomerDetails" checked={settings.showCustomerDetails} onCheckedChange={(c) => handleSwitchChange('showCustomerDetails', c)} />
                                    <Label htmlFor="showCustomerDetails">Show Customer Details</Label>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="footerNotes">Footer Notes</Label>
                            <Textarea id="footerNotes" name="footerNotes" value={settings.footerNotes} onChange={handleInputChange} placeholder="e.g., Thank you! Please come again." />
                        </div>
                         <Separator />
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
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
                    </div>
                    <div className="lg:col-span-1">
                        <div className="sticky top-20">
                        <h3 className="text-base font-semibold mb-2 font-headline">Receipt Preview</h3>
                        <ReceiptPreview settings={settings} store={store} />
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
