
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Minus, Plus } from 'lucide-react';
import { Table as TableType, MenuItem, Order, OrderItem } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
    
    const firestore = useFirestore();

    const unlimitedPackages = menu.filter(item => item.category === 'Unlimited');

    useEffect(() => {
        // Reset state when modal opens
        if (isOpen) {
            setCustomerName('');
            setGuestCount(2);
            setSelectedPackage(null);
        }
    }, [isOpen]);

    const handleClose = () => {
        onClose();
    };

    const handlePackageChange = (menuItemId: string) => {
        const pkg = unlimitedPackages.find(p => p.id === menuItemId);
        setSelectedPackage(pkg || null);
    }
    
    const handleStartOrder = async () => {
        if (!firestore || !table || !selectedPackage || !customerName) {
          alert("Please ensure Customer Name and a Package are selected.");
          return;
        }

        const newOrderRef = doc(collection(firestore, 'orders'));
        const tableRef = doc(firestore, 'tables', table.id);

        try {
            const batch = writeBatch(firestore);

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
                initialFlavors: [],
                packageName: selectedPackage.menuName,
            } as Omit<Order, 'id'>);

            // 2. Add the selected package as the first order item
            const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
            batch.set(orderItemRef, {
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
                    <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="package">Select Package</Label>
                    <Select onValueChange={handlePackageChange} value={selectedPackage?.id}>
                        <SelectTrigger>
                            <SelectValue placeholder="Choose an unlimited package..." />
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
                <div className="space-y-2">
                    <Label htmlFor="guestCount">No. of Guests</Label>
                    <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGuestCount(c => Math.max(1, c - 1))}><Minus className="h-4 w-4"/></Button>
                        <Input id="guestCount" type="number" value={guestCount} onChange={e => setGuestCount(Number(e.target.value))} min="1" required className="w-full text-center" />
                        <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGuestCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                    </div>
                </div>
            </div>
            <DialogFooter className="flex-row justify-end">
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                    Cancel
                    </Button>
                </DialogClose>
                <Button onClick={handleStartOrder} disabled={!selectedPackage || !customerName}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Start Order
                </Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    )
}
