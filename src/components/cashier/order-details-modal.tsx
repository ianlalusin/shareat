'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, doc, updateDoc } from 'firebase/firestore';
import { Order, OrderItem, RefillItem } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, BellRing, CheckCircle, Hourglass } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Timestamp } from 'firebase/firestore';

interface OrderDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
}

const calculateLapseTime = (start: Timestamp | undefined, end: Timestamp | undefined) => {
  if (!start || !end) return '';
  const diff = end.toMillis() - start.toMillis();
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export function OrderDetailsModal({ isOpen, onClose, order }: OrderDetailsModalProps) {
  const firestore = useFirestore();
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [refillItems, setRefillItems] = useState<RefillItem[]>([]);

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

    return () => {
      orderItemsUnsubscribe();
      refillItemsUnsubscribe();
    };
  }, [firestore, order.id]);

  const allItems = [...orderItems, ...refillItems].sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

  const pendingItems = allItems.filter(item => item.status === 'Pending');

  const handleBuzz = () => {
    // In a real app, this would trigger a notification to the kitchen/bar.
    // For now, we can just log it to the console.
    console.log(`Buzzing kitchen for order ${order.id} for pending items!`);
    alert(`Kitchen has been notified about ${pendingItems.length} pending item(s).`);
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Order Details</DialogTitle>
          <div className="text-sm text-muted-foreground pt-1">
            <span className="font-semibold">Table:</span> {order.tableLabel} | <span className="font-semibold">Package:</span> {order.packageName} | <span className="font-semibold">Guests:</span> {order.guestCount} | <span className="font-semibold">Customer:</span> {order.customerName}
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          <div className="grid gap-4">
            <div>
              <h3 className="text-md font-semibold mb-2">Initial Order & Add-ons</h3>
              <div className="space-y-2">
                {orderItems.map(item => (
                  <div key={item.id} className={cn("flex items-center justify-between p-2 rounded-lg", item.status === 'Pending' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
                    <div className="flex items-center gap-2">
                        {item.status === 'Pending' ? <Hourglass className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                        <span className="font-medium">{item.quantity}x {item.menuName}</span>
                    </div>
                    {item.status === 'Served' && (
                        <span className="text-xs text-muted-foreground">
                            {calculateLapseTime(item.timestamp, item.servedTimestamp)}
                        </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-md font-semibold mb-2">Refill History</h3>
              <div className="space-y-2">
                {refillItems.length > 0 ? refillItems.map(item => (
                  <div key={item.id} className={cn("flex items-center justify-between p-2 rounded-lg", item.status === 'Pending' ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
                     <div className="flex items-center gap-2">
                        {item.status === 'Pending' ? <Hourglass className="h-4 w-4 text-red-500" /> : <CheckCircle className="h-4 w-4 text-green-500" />}
                        <span className="font-medium">{item.quantity}x Refill - {item.menuName}</span>
                    </div>
                     {item.status === 'Served' && (
                        <span className="text-xs text-muted-foreground">
                            {calculateLapseTime(item.timestamp, item.servedTimestamp)}
                        </span>
                    )}
                  </div>
                )) : <p className="text-sm text-muted-foreground text-center py-4">No refills requested yet.</p>}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4">
           {pendingItems.length > 0 && <Badge variant="destructive" className="mr-auto gap-1"><AlertTriangle className="h-3 w-3" />{pendingItems.length} item(s) pending</Badge>}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleBuzz} disabled={pendingItems.length === 0}>
            <BellRing className="mr-2 h-4 w-4" />
            Buzz Kitchen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
