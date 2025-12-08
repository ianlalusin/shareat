
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Minus, Plus, ChevronDown } from 'lucide-react';
import { Table as TableType, MenuItem, Order, OrderItem, GListItem } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { collection, doc, writeBatch, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { useSuccessModal } from '@/store/use-success-modal';

interface NewOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    table: TableType;
    menu: MenuItem[];
    storeId: string;
}

export function NewOrderModal({ isOpen, onClose, table, menu, storeId }: NewOrderModalProps) {
    const [customerName, setCustomerName] = useState('');
    const [guestCount, setGuestCount] = useState(2);
    const [selectedPackage, setSelectedPackage] = useState<MenuItem | null>(null);
    const [rice, setRice] = useState(2);
    const [cheese, setCheese] = useState(2);
    const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
    const [flavorOptions, setFlavorOptions] = useState<GListItem[]>([]);
    
    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();

    const unlimitedPackages = menu.filter(item => item.category === 'Unlimited');
    
    useEffect(() => {
        if(firestore && storeId) {
            const flavorsQuery = query(
                collection(firestore, 'lists'),
                where('category', '==', 'meat flavor'),
                where('is_active', '==', true),
                where('storeIds', 'array-contains', storeId)
            );
            const unsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
                const flavors = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as GListItem);
                setFlavorOptions(flavors);
            });
            return () => unsubscribe();
        }
    }, [firestore, storeId]);

    useEffect(() => {
        // Reset state when modal opens
        if (isOpen) {
            setCustomerName('');
            setGuestCount(2);
            setSelectedPackage(null);
            setRice(2);
            setCheese(2);
            setSelectedFlavors([]);
        }
    }, [isOpen]);

    useEffect(() => {
        setRice(guestCount);
        setCheese(guestCount);
    }, [guestCount]);


    const handleClose = () => {
        onClose();
    };

    const handlePackageChange = (menuItemId: string) => {
        const pkg = unlimitedPackages.find(p => p.id === menuItemId);
        setSelectedPackage(pkg || null);
    }

    const handleFlavorSelect = (flavor: string) => {
        setSelectedFlavors(prev => {
            const isSelected = prev.includes(flavor);
            if (isSelected) {
                return prev.filter(f => f !== flavor);
            } else {
                if (prev.length < 3) {
                    return [...prev, flavor];
                }
                return prev; // Do not add more than 3
            }
        });
    };
    
    const getSelectedFlavorText = () => {
        if (selectedFlavors.length === 0) return 'Select up to 3 flavors';
        if (selectedFlavors.length > 2) return `${'selectedFlavors.length'} flavors selected`;
        return selectedFlavors.join(', ');
    };
    
    const handleStartOrder = async () => {
        if (!firestore || !table || !selectedPackage || selectedFlavors.length === 0) {
          alert("Please ensure a Package and at least one Flavor are selected.");
          return;
        }

        const newOrderRef = doc(collection(firestore, 'orders'));
        const tableRef = doc(firestore, 'tables', table.id);

        try {
            const batch = writeBatch(firestore);

            const initialItems = [];
            if (rice > 0) initialItems.push({ name: 'Rice', quantity: rice });
            if (cheese > 0) initialItems.push({ name: 'Cheese', quantity: cheese });

            // 1. Create the new order
            batch.set(newOrderRef, {
                storeId: storeId,
                tableLabel: table.tableName,
                status: 'Active',
                guestCount: guestCount,
                customerName: customerName,
                orderTimestamp: serverTimestamp(),
                totalAmount: selectedPackage.price * guestCount, // Initial total
                notes: '',
                initialItems: initialItems,
                packageName: selectedPackage.menuName,
                selectedFlavors: selectedFlavors,
            } as Omit<Order, 'id'>);

            // 2. Add the selected package as the first order item
            const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
            batch.set(orderItemRef, {
                storeId: storeId,
                menuItemId: selectedPackage.id,
                menuName: selectedPackage.menuName,
                quantity: guestCount,
                priceAtOrder: selectedPackage.price,
                isRefill: false,
                timestamp: serverTimestamp(),
                status: 'Pending',
                targetStation: selectedPackage.targetStation
            } as Omit<OrderItem, 'id' | 'orderId'>);

            // 3. Update the table
            batch.update(tableRef, {
              status: 'Occupied',
              activeOrderId: newOrderRef.id,
              resetCounter: (table.resetCounter || 0) + 1,
            });
        
            await batch.commit();
        
            handleClose();
            openSuccessModal();

        } catch (error) {
            console.error("Error creating new order: ", error);
            alert("Failed to create new order. Please try again.");
        }
    }


    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>New Order for {table?.tableName}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
                <div className="space-y-2">
                    <Label htmlFor="customerName">Customer Name</Label>
                    <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </div>
                
                 <div className="grid grid-cols-5 gap-4">
                    <div className="space-y-2 col-span-2">
                         <Label htmlFor="guestCount">Guests</Label>
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setGuestCount(c => Math.max(1, c - 1))}><Minus className="h-4 w-4"/></Button>
                            <Input id="guestCount" type="number" value={guestCount} onChange={e => setGuestCount(Number(e.target.value))} min="1" required className="w-full text-center h-10" />
                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setGuestCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                        </div>
                    </div>
                     <div className="space-y-2 col-span-3">
                        <Label htmlFor="package">Package</Label>
                        <Select onValueChange={handlePackageChange} value={selectedPackage?.id}>
                            <SelectTrigger className="h-10">
                                <SelectValue placeholder="Choose package..." />
                            </SelectTrigger>
                            <SelectContent>
                                {unlimitedPackages.map(pkg => (
                                    <SelectItem key={pkg.id} value={pkg.id}>
                                        {pkg.menuName}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                     <div className="space-y-2 col-span-1">
                         <Label htmlFor="flavor">Flavor</Label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full justify-between h-10">
                                    <span>{getSelectedFlavorText()}</span>
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                {flavorOptions.map(opt => (
                                    <DropdownMenuCheckboxItem
                                        key={opt.id}
                                        checked={selectedFlavors.includes(opt.item)}
                                        onSelect={(e) => e.preventDefault()}
                                        onClick={() => handleFlavorSelect(opt.item)}
                                        disabled={!selectedFlavors.includes(opt.item) && selectedFlavors.length >= 3}
                                    >
                                        {opt.item}
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                     </div>
                     <div className="space-y-2 col-span-1">
                         <Label htmlFor="rice" className="text-center block">Rice</Label>
                         <div className="flex items-center gap-1">
                             <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setRice(r => Math.max(0, r - 1))}><Minus className="h-4 w-4"/></Button>
                             <Input id="rice" type="number" value={rice} onChange={e => setRice(Number(e.target.value))} className="w-full text-center h-10" />
                             <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setRice(r => r + 1)}><Plus className="h-4 w-4"/></Button>
                         </div>
                     </div>
                      <div className="space-y-2 col-span-1">
                         <Label htmlFor="cheese" className="text-center block">Cheese</Label>
                         <div className="flex items-center gap-1">
                             <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setCheese(c => Math.max(0, c - 1))}><Minus className="h-4 w-4"/></Button>
                             <Input id="cheese" type="number" value={cheese} onChange={e => setCheese(Number(e.target.value))} className="w-full text-center h-10" />
                             <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => setCheese(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                         </div>
                     </div>
                </div>

            </div>
            <DialogFooter className="flex-row justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                    Cancel
                </Button>
                <Button onClick={handleStartOrder} disabled={!selectedPackage || selectedFlavors.length === 0}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Start Order
                </Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    )
}
