
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, doc, deleteDoc, updateDoc, writeBatch, where } from 'firebase/firestore';
import { Order, OrderItem, RefillItem, MenuItem } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, BellRing, CheckCircle, Hourglass, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Timestamp } from 'firebase/firestore';
import { AddToCartModal } from './add-to-cart-modal';
import { useSuccessModal } from '@/store/use-success-modal';
import { Badge } from '@/components/ui/badge';


interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

const calculateLapseTime = (start: Timestamp | undefined, end: Timestamp | undefined) => {
  if (!start || !end) return '';
  if (typeof start.toMillis !== 'function' || typeof end.toMillis !== 'function') return '';
  const diff = end.toMillis() - start.toMillis();
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export function OrderDetailsModal({ isOpen, onClose, order }: OrderDetailsModalProps) {
  const firestore = useFirestore();
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [refillItems, setRefillItems] = useState<RefillItem[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [isUpdateSelectionModalOpen, setIsUpdateSelectionModalOpen] = useState(false);
  const [isAddToCartModalOpen, setIsAddToCartModalOpen] = useState(false);
  const { openSuccessModal } = useSuccessModal();


  useEffect(() => {
    if (!firestore || !order.id) return;

    const orderItemsQuery = query(collection(firestore, 'orders', order.id, 'orderItems'));
    const orderItemsUnsubscribe = onSnapshot(orderItemsQuery, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrderItem));
      setOrderItems(items);
    });

    const refillItemsQuery = query(collection(firestore, 'orders', order.id, 'refills'));
    const refillItemsUnsubscribe = onSnapshot(refillItemsQuery, (snapshot) => {
        const items = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as RefillItem));
        setRefillItems(items);
    });

    const menuQuery = query(
        collection(firestore, 'menu'),
        where('storeId', '==', order.storeId),
        where('isAvailable', '==', true)
    );
    const menuUnsubscribe = onSnapshot(menuQuery, (snapshot) => {
        const menuData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as MenuItem));
        setMenu(menuData);
    });


    return () => {
      orderItemsUnsubscribe();
      refillItemsUnsubscribe();
      menuUnsubscribe();
    };
  }, [firestore, order.id, order.storeId]);

  const allItems = [...orderItems, ...refillItems].sort((a, b) => {
    if (a.timestamp && b.timestamp) {
        return a.timestamp.toMillis() - b.timestamp.toMillis();
    }
    return 0;
  });

  const pendingItems = allItems.filter(item => item.status === 'Pending');
  
  const unlimitedPackageItem = orderItems.find(item => item.menuName === order.packageName);
  
  const groupedAlaCarteItems = useMemo(() => {
    const alaCarteItems = orderItems.filter(item => item.id !== unlimitedPackageItem?.id);
    const itemMap = new Map<string, { menuItemId: string; menuName: string; quantity: number; status: OrderItem['status'] }>();

    for (const item of alaCarteItems) {
      const existing = itemMap.get(item.menuItemId);
      if (existing) {
        existing.quantity += item.quantity;
        // If any of the grouped items is pending, the whole group is pending
        if (item.status === 'Pending') {
          existing.status = 'Pending';
        }
      } else {
        itemMap.set(item.menuItemId, {
          menuItemId: item.menuItemId,
          menuName: item.menuName,
          quantity: item.quantity,
          status: item.status,
        });
      }
    }
    return Array.from(itemMap.values());
  }, [orderItems, unlimitedPackageItem]);

  const groupedRefillItems = useMemo(() => {
    const itemMap = new Map<string, { menuItemId: string; menuName: string; quantity: number; status: RefillItem['status']; servedTimestamp?: Timestamp; timestamp: Timestamp }>();

    for (const item of refillItems) {
      const key = `${item.menuItemId}-${item.status}`;
      const existing = itemMap.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        itemMap.set(key, {
          menuItemId: item.menuItemId,
          menuName: item.menuName,
          quantity: item.quantity,
          status: item.status,
          servedTimestamp: item.servedTimestamp,
          timestamp: item.timestamp,
        });
      }
    }
    return Array.from(itemMap.values());
  }, [refillItems]);


  const handleBuzz = () => {
    console.log(`Buzzing kitchen for order ${order.id} for pending items!`);
    alert(`Kitchen has been notified about ${pendingItems.length} item(s).`);
  }

  const handleCloseCart = () => {
    setIsAddToCartModalOpen(false);
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Order Details</DialogTitle>
          <div className="text-sm text-muted-foreground pt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="font-semibold">Table:</span> {order.tableLabel}</span>
            <span><span className="font-semibold">Package:</span> {order.packageName}</span>
            <span><span className="font-semibold">Guests:</span> {order.guestCount}</span>
            <span><span className="font-semibold">Customer:</span> {order.customerName}</span>
            <div className="w-full"><span className="font-semibold">Flavors:</span> {(order.selectedFlavors || []).join(', ')}</div>
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          <div className="grid gap-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-md font-semibold">Initial Order & Add-ons</h3>
                <Button variant="outline" size="sm" onClick={() => setIsAddToCartModalOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
              </div>
              <div className="space-y-2">
                {unlimitedPackageItem && (
                   <div className={cn("flex items-center justify-between p-2 rounded-lg", unlimitedPackageItem.status === 'Pending' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
                      <div className="flex items-center gap-2">
                          {unlimitedPackageItem.status === 'Pending' ? <Hourglass className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                          <span className="font-medium">{unlimitedPackageItem.quantity}x {unlimitedPackageItem.menuName}</span>
                      </div>
                      <Badge variant="secondary">Package</Badge>
                  </div>
                )}
                {groupedAlaCarteItems.map(item => (
                  <div key={item.menuItemId} className={cn("flex items-center justify-between p-2 rounded-lg", item.status === 'Pending' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
                    <div className="flex items-center gap-2">
                        {item.status === 'Pending' ? <Hourglass className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                        <span className="font-medium">{item.quantity}x {item.menuName}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-md font-semibold mb-2">Refill History</h3>
              <div className="space-y-2">
                {groupedRefillItems.length > 0 ? groupedRefillItems.map(item => (
                  <div key={`${item.menuItemId}-${item.status}`} className={cn("flex items-center justify-between p-2 rounded-lg", item.status === 'Pending' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
                     <div className="flex items-center gap-2">
                        {item.status === 'Pending' ? <Hourglass className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                        <span className="font-medium">{item.quantity}x Refill - {item.menuName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {item.status === 'Served' && item.servedTimestamp && (
                            <span className="text-xs text-muted-foreground">
                                {calculateLapseTime(item.timestamp, item.servedTimestamp)}
                            </span>
                        )}
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-4">No refills requested yet.</p>}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4 sm:justify-between">
           <div className="flex items-center gap-2">
            {pendingItems.length > 0 && <div className="flex items-center gap-1.5 text-sm text-destructive font-medium"><AlertTriangle className="h-4 w-4" />{pendingItems.length} item(s) pending</div>}
           </div>
           <div className="flex gap-2 justify-end">
             <Button variant="outline" onClick={onClose}>
                Close
             </Button>
             <Button onClick={handleBuzz} disabled={pendingItems.length === 0}>
                <BellRing className="mr-2 h-4 w-4" />
                Buzz Kitchen
             </Button>
             <Button variant="outline" onClick={() => setIsUpdateSelectionModalOpen(true)}>
                Update Order
             </Button>
           </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {isAddToCartModalOpen && (
      <AddToCartModal
        isOpen={isAddToCartModalOpen}
        onClose={handleCloseCart}
        order={order}
        menu={menu}
      />
    )}

    <Dialog open={isUpdateSelectionModalOpen} onOpenChange={setIsUpdateSelectionModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Update Order</DialogTitle>
                <DialogDescription>
                    What would you like to update for this order?
                </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <Button variant="outline" size="lg">Update Guest Count</Button>
                <Button variant="outline" size="lg">Update Package</Button>
            </div>
        </DialogContent>
    </Dialog>
    </>
  );
}
