
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { doc, writeBatch, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { Order, OrderItem } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface PendingItemsModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  pendingItems: OrderItem[];
}

export function PendingItemsModal({
  isOpen,
  onClose,
  order,
  pendingItems,
}: PendingItemsModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const handleIncludeAddOns = async () => {
    if (!firestore || !order) return;
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      pendingItems.forEach(item => {
        const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);
        batch.update(itemRef, { status: 'Served', servedTimestamp: serverTimestamp() });
      });
      await batch.commit();
      toast({ title: "Items Added", description: "Pending items were marked as served." });
      router.push(`/cashier/order/${order.id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not include items." });
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  const handleClearPendingItems = async () => {
    if (!firestore || !order) return;
    setIsProcessing(true);
    try {
      const batch = writeBatch(firestore);
      pendingItems.forEach(item => {
        const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);
        batch.delete(itemRef);
      });
      await batch.commit();
      toast({ title: "Items Cleared", description: "Pending items have been removed." });
      router.push(`/cashier/order/${order.id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not clear pending items." });
    } finally {
      setIsProcessing(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pending Kitchen Items</AlertDialogTitle>
          <AlertDialogDescription>
            <div className="text-sm text-muted-foreground space-y-2 py-2">
              <p>This order has the following unserved items:</p>
              <ul className="list-disc list-inside text-foreground font-medium">
                {pendingItems.map(item => (
                  <li key={item.id}>{item.quantity}x {item.menuName}</li>
                ))}
              </ul>
              <p className="pt-2">Would you like to mark them as "Served" and add them to the bill, or clear them from the order?</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose} disabled={isProcessing}>Cancel</AlertDialogCancel>
          <Button variant="destructive" onClick={handleClearPendingItems} disabled={isProcessing}>
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Clear Items
          </Button>
          <Button onClick={handleIncludeAddOns} disabled={isProcessing}>
            {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add to Bill
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
