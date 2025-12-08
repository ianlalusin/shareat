
'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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
import { ReceiptSettings } from '@/lib/types';
import { useSuccessModal } from '@/store/use-success-modal';
import { ImageUpload } from '@/components/ui/image-upload';
import { Receipt } from 'lucide-react';
import { useStorage } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const initialSettingsState: Omit<ReceiptSettings, 'id'> = {
    logoUrl: '',
    receiptNumberPrefix: '',
    nextReceiptNumber: 1,
    showStoreAddress: true,
    showContactInfo: true,
    showTinNumber: false,
    footerNotes: '',
    printerType: 'thermal',
    paperWidth: '58mm',
};

export default function ReceiptSettingsPage() {
    const [settings, setSettings] = useState<Omit<ReceiptSettings, 'id'>>(initialSettingsState);
    const [loading, setLoading] = useState(true);
    const [logoFile, setLogoFile] = useState<File | null>(null);

    const { selectedStoreId } = useStoreSelector();
    const firestore = useFirestore();
    const storage = useStorage();
    const { openSuccessModal } = useSuccessModal();

    useEffect(() => {
        if (!firestore || !selectedStoreId) {
            setLoading(false);
            return;
        }

        const fetchSettings = async () => {
            setLoading(true);
            const settingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
            const docSnap = await getDoc(settingsRef);

            if (docSnap.exists()) {
                setSettings({ ...initialSettingsState, ...docSnap.data() });
            } else {
                setSettings(initialSettingsState);
            }
            setLoading(false);
        };

        fetchSettings();
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
    
    const handleFileChange = (file: File | null) => {
        setLogoFile(file);
        if(file){
            setSettings(prev => ({...prev, logoUrl: URL.createObjectURL(file)}))
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!firestore || !storage || !selectedStoreId) return;
        
        let logoUrl = settings.logoUrl || '';
        if (logoFile) {
            try {
                const logoRef = ref(storage, `Shareat Hub/receipt_logos/${Date.now()}_${logoFile.name}`);
                const snapshot = await uploadBytes(logoRef, logoFile);
                logoUrl = await getDownloadURL(snapshot.ref);
            } catch (error) {
                console.error("Error uploading image:", error);
            }
        }

        try {
            const settingsRef = doc(firestore, 'receiptSettings', selectedStoreId);
            await setDoc(settingsRef, {...settings, logoUrl }, { merge: true });
            openSuccessModal();
        } catch (error) {
            console.error("Error saving settings:", error);
            alert("Failed to save settings.");
        }
    };

    if (!selectedStoreId) {
        return (
            <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
                <h1 className="text-lg font-semibold md:text-2xl font-headline">Receipt Settings</h1>
                <Alert>
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
                <Card>
                    <CardHeader>
                        <Skeleton className="h-7 w-48" />
                        <Skeleton className="h-4 w-full mt-2" />
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                           <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                           <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                        </div>
                        <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-24 w-full" /></div>
                    </CardContent>
                </Card>
             </main>
        )
    }

    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <h1 className="text-lg font-semibold md:text-2xl font-headline">Receipt Settings</h1>

            <form onSubmit={handleSubmit}>
                <Card>
                    <CardHeader>
                        <CardTitle>General Configuration</CardTitle>
                        <CardDescription>Customize the look and numbering of your receipts for the selected store.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                            <Label>Display Options</Label>
                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
                
                 <Card className="mt-6">
                    <CardHeader>
                        <CardTitle>Hardware & Branding</CardTitle>
                        <CardDescription>Configure printer settings and upload a logo for your receipts.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
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
                        <div className="space-y-2">
                           <Label>Receipt Logo</Label>
                           <ImageUpload 
                                imageUrl={settings.logoUrl}
                                onFileChange={handleFileChange}
                                icon={<Receipt className="h-10 w-10 text-muted-foreground" />}
                           />
                        </div>
                    </CardContent>
                 </Card>

                <div className="flex justify-end mt-6">
                    <Button type="submit">Save Settings</Button>
                </div>
            </form>
        </main>
    );
}
