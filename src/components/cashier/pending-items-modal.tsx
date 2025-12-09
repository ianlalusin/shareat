
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useFirestore } from '@/firebase';
import { doc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
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
  pendingItems: initialPendingItems,
}: PendingItemsModalProps) {
  const [processingItemId, setProcessingItemId] = useState<string | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [localPendingItems, setLocalPendingItems] = useState(initialPendingItems);
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const handleIncludeSingleItem = async (itemToInclude: OrderItem) => {
    if (!firestore || !order) return;
    setProcessingItemId(itemToInclude.id);
    try {
      const itemRef = doc(firestore, 'orders', order.id, 'orderItems', itemToInclude.id);
      await updateDoc(itemRef, { status: 'Served', servedTimestamp: serverTimestamp() });
      toast({ title: "Item Added", description: `1x ${itemToInclude.menuName} added to the bill.` });
      setLocalPendingItems(prev => prev.filter(item => item.id !== itemToInclude.id));
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not include item." });
    } finally {
      setProcessingItemId(null);
    }
  };

  const handleClearSingleItem = async (itemToClear: OrderItem) => {
    if (!firestore || !order) return;
    setProcessingItemId(itemToClear.id);
    try {
      const itemRef = doc(firestore, 'orders', order.id, 'orderItems', itemToClear.id);
      await deleteDoc(itemRef);
      toast({ title: "Item Cleared", description: `1x ${itemToClear.menuName} has been removed.` });
      setLocalPendingItems(prev => prev.filter(item => item.id !== itemToClear.id));
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not clear item." });
    } finally {
      setProcessingItemId(null);
    }
  };
  
  const handleIncludeAll = async () => {
    if (!firestore || !order || localPendingItems.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const batch = writeBatch(firestore);
      localPendingItems.forEach(item => {
        const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);
        batch.update(itemRef, { status: 'Served', servedTimestamp: serverTimestamp() });
      });
      await batch.commit();
      toast({ title: "All Items Added", description: "All pending items added to the bill."});
      setLocalPendingItems([]);
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not include all items." });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleClearAll = async () => {
    if (!firestore || !order || localPendingItems.length === 0) return;
    setIsBatchProcessing(true);
    try {
      const batch = writeBatch(firestore);
      localPendingItems.forEach(item => {
        const itemRef = doc(firestore, 'orders', order.id, 'orderItems', item.id);
        batch.delete(itemRef);
      });
      await batch.commit();
      toast({ title: "All Items Cleared", description: "All pending items have been removed." });
      setLocalPendingItems([]);
    } catch (error) {
      toast({ variant: 'destructive', title: "Error", description: "Could not clear all items." });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  const handleDone = () => {
    onClose();
    router.push(`/cashier/order/${order.id}`);
  };
  
  const handleDialogClose = () => {
    if (processingItemId || isBatchProcessing) return; // Prevent closing while an action is in progress
    onClose();
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={handleDialogClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pending Kitchen Items</AlertDialogTitle>
           <div className="text-sm text-muted-foreground pt-2">
            This order has unserved items. Choose to add them to the bill (mark as served) or clear them.
          </div>
        </AlertDialogHeader>
        
        <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
          {localPendingItems.length > 0 ? localPendingItems.map(item => (
            <div key={item.id} className="flex items-center justify-between p-2 border rounded-md bg-muted/50">
              <span className="font-medium text-sm">{item.quantity}x {item.menuName}</span>
              <div className="flex gap-2">
                 <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleIncludeSingleItem(item)}
                  disabled={!!processingItemId || isBatchProcessing}
                >
                  {processingItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin"/> : "Add to Bill"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleClearSingleItem(item)}
                  disabled={!!processingItemId || isBatchProcessing}
                >
                   {processingItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin"/> : "Clear"}
                </Button>
              </div>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground text-center py-8">All pending items have been handled.</p>
          )}
        </div>

        <AlertDialogFooter>
          <div className='flex flex-wrap gap-2 justify-end items-center w-full'>
            <Button
                variant="outline"
                onClick={handleIncludeAll}
                disabled={isBatchProcessing || localPendingItems.length === 0}
            >
                {isBatchProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Add All to Bill
            </Button>
            <Button
                variant="destructive"
                onClick={handleClearAll}
                disabled={isBatchProcessing || localPendingItems.length === 0}
            >
                {isBatchProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Clear All Pending
            </Button>
            <div className="flex-grow sm:flex-grow-0" />
            <Button onClick={handleDone}>
                Done
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
