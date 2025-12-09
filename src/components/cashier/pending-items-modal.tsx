
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
import { doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
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

  const handleDone = () => {
    onClose();
    router.push(`/cashier/order/${order.id}`);
  };
  
  const handleDialogClose = () => {
    if (processingItemId) return; // Prevent closing while an action is in progress
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
                  disabled={!!processingItemId}
                >
                  {processingItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin"/> : "Add to Bill"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleClearSingleItem(item)}
                  disabled={!!processingItemId}
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
          <Button onClick={handleDone}>
            Done
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

