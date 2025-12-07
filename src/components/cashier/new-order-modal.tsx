
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
import { PlusCircle, Minus, Plus, Trash2 } from 'lucide-react';
import { Table as TableType, MenuItem, Order, OrderItem } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { collection, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '../ui/separator';

type OrderItemDraft = {
    menuItem: MenuItem;
    quantity: number;
}

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
    const [orderItems, setOrderItems] = useState<OrderItemDraft[]>([]);
    const [search, setSearch] = useState('');
    
    const firestore = useFirestore();

    const resetForm = () => {
        setCustomerName('');
        setGuestCount(2);
        setOrderItems([]);
        setSearch('');
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleAddToOrder = (item: MenuItem) => {
        setOrderItems(prev => {
            const existing = prev.find(i => i.menuItem.id === item.id);
            if (existing) {
                return prev.map(i => i.menuItem.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
            }
            return [...prev, { menuItem: item, quantity: 1 }];
        });
        setSearch('');
    };
    
    const updateQuantity = (menuItemId: string, change: number) => {
        setOrderItems(prev => {
            const updated = prev.map(item => {
                if (item.menuItem.id === menuItemId) {
                    return { ...item, quantity: Math.max(0, item.quantity + change) };
                }
                return item;
            });
            // Remove item if quantity is 0
            return updated.filter(item => item.quantity > 0);
        });
    };

    const subtotal = orderItems.reduce((acc, item) => acc + (item.menuItem.price * item.quantity), 0);
    
    const filteredMenu = menu.filter(item => 
        item.menuName.toLowerCase().includes(search.toLowerCase()) &&
        !orderItems.some(oi => oi.menuItem.id === item.id)
    ).slice(0, 5);

    const handleStartOrder = async () => {
        if (!firestore || !table || orderItems.length === 0 || !customerName) {
          alert("Please ensure Customer Name is filled and at least one item is added.");
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
                totalAmount: subtotal, // Initial total
                notes: '',
                initialFlavors: [], // This might need revisiting if packages are used
                packageName: orderItems.length === 1 ? orderItems[0].menuItem.menuName : `${orderItems.length} items`,
            } as Omit<Order, 'id'>);

            // 2. Add all items to the orderItems subcollection
            orderItems.forEach(item => {
                const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
                batch.set(orderItemRef, {
                    menuItemId: item.menuItem.id,
                    menuName: item.menuItem.menuName,
                    quantity: item.quantity,
                    priceAtOrder: item.menuItem.price,
                    isRefill: false,
                    timestamp: serverTimestamp(),
                    status: 'Pending',
                    targetStation: item.menuItem.targetStation
                } as Omit<OrderItem, 'id' | 'orderId'>);
            });

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
        <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
            <DialogTitle>New Order for Table {table?.tableName}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
                {/* Top Section */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="customerName">Customer Name</Label>
                        <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
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

                {/* Menu Search */}
                <div className="space-y-2 relative">
                    <Label htmlFor="menu-search">Add Item</Label>
                    <Input 
                        id="menu-search"
                        placeholder="Search menu..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && filteredMenu.length > 0 && (
                        <div className="absolute z-10 w-full bg-background border rounded-md shadow-lg mt-1">
                            {filteredMenu.map(item => (
                                <div key={item.id} className="p-2 hover:bg-muted cursor-pointer" onClick={() => handleAddToOrder(item)}>
                                    {item.menuName} - {formatCurrency(item.price)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Order Items List */}
                <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2">
                    <h3 className="font-semibold text-md sticky top-0 bg-background/95 backdrop-blur-sm pb-2">Current Order</h3>
                    {orderItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">No items added yet.</p>
                    ) : (
                        orderItems.map(item => (
                            <div key={item.menuItem.id} className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="font-medium">{item.menuItem.menuName}</p>
                                    <p className="text-xs text-muted-foreground">{formatCurrency(item.menuItem.price)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.menuItem.id, -1)}><Minus className="h-4 w-4"/></Button>
                                    <span className="font-bold w-4 text-center">{item.quantity}</span>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.menuItem.id, 1)}><Plus className="h-4 w-4"/></Button>
                                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setOrderItems(prev => prev.filter(i => i.menuItem.id !== item.menuItem.id))}><Trash2 className="h-4 w-4"/></Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Subtotal */}
                 {orderItems.length > 0 && (
                    <>
                        <Separator />
                        <div className="flex justify-between items-center text-lg font-bold">
                            <span>Subtotal</span>
                            <span>{formatCurrency(subtotal)}</span>
                        </div>
                    </>
                 )}
            </div>
            <DialogFooter>
            <DialogClose asChild>
                <Button type="button" variant="outline">
                Cancel
                </Button>
            </DialogClose>
            <Button onClick={handleStartOrder} disabled={orderItems.length === 0 || !customerName}>
                <PlusCircle className="mr-2 h-4 w-4" /> Start Order
            </Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    )
}
