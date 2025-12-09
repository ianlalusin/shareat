
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Order, MenuItem, OrderUpdateLog } from '@/lib/types';
import { useFirestore, useAuthContext } from '@/firebase';
import { doc, writeBatch, serverTimestamp, collection, runTransaction } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface UpdateOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  menu: MenuItem[];
  updateType: 'guestCount' | 'package';
}

export function UpdateOrderModal({ isOpen, onClose, order, menu, updateType }: UpdateOrderModalProps) {
  const [guestCount, setGuestCount] = useState(order.guestCount);
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(
    () => menu.find(m => m.menuName === order.packageName)?.id
  );
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const firestore = useFirestore();
  const { user } = useAuthContext();
  const { toast } = useToast();

  const unlimitedPackages = menu.filter(item => item.category === 'Unlimited');

  useEffect(() => {
    if (isOpen) {
      setGuestCount(order.guestCount);
      setSelectedPackageId(menu.find(m => m.menuName === order.packageName)?.id);
      setReason('');
      setIsSubmitting(false);
    }
  }, [isOpen, order, menu]);

  const handleSubmit = async () => {
    if (!reason) {
      toast({ variant: 'destructive', title: 'Reason required', description: 'Please provide a reason for the update.' });
      return;
    }
    if (!firestore || !user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not submit update. Please try again.' });
      return;
    }

    setIsSubmitting(true);

    try {
        await runTransaction(firestore, async (transaction) => {
            const orderRef = doc(firestore, 'orders', order.id);
            const orderDoc = await transaction.get(orderRef);
            if(!orderDoc.exists()) throw new Error("Order not found.");

            const currentOrder = orderDoc.data() as Order;
            const newPackage = menu.find(m => m.id === selectedPackageId);
            if (!newPackage) throw new Error("Selected package not found.");

            const updates: Partial<Order> = {};
            const auditChanges: OrderUpdateLog['changes'] = [];

            if (updateType === 'guestCount' && guestCount !== currentOrder.guestCount) {
                updates.guestCount = guestCount;
                auditChanges.push({ field: 'guestCount', oldValue: currentOrder.guestCount, newValue: guestCount });
            }

            if (updateType === 'package' && newPackage.menuName !== currentOrder.packageName) {
                updates.packageName = newPackage.menuName;
                auditChanges.push({ field: 'packageName', oldValue: currentOrder.packageName, newValue: newPackage.menuName });
            }

            if (auditChanges.length === 0) {
                toast({ title: 'No changes detected.' });
                setIsSubmitting(false);
                onClose();
                return;
            }
            
            const newTotalAmount = (updates.guestCount || currentOrder.guestCount) * (newPackage.price);
            if (newTotalAmount !== currentOrder.totalAmount) {
                updates.totalAmount = newTotalAmount;
                auditChanges.push({ field: 'totalAmount', oldValue: currentOrder.totalAmount, newValue: newTotalAmount });
            }

            // Create audit log
            const auditLogRef = doc(collection(firestore, 'orders', order.id, 'orderAudits'));
            const auditLog: Omit<OrderUpdateLog, 'id'> = {
                orderId: order.id,
                storeId: order.storeId,
                timestamp: serverTimestamp() as any,
                updatedByUid: user.uid,
                updatedByName: user.displayName || user.email!,
                reason: reason,
                changes: auditChanges,
            };

            transaction.set(auditLogRef, auditLog);
            transaction.update(orderRef, updates);
        });

      toast({ title: 'Success', description: 'Order has been updated.' });
      onClose();

    } catch (error) {
      console.error('Error updating order:', error);
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: error instanceof Error ? error.message : 'An unknown error occurred.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update Order</DialogTitle>
          <DialogDescription>
            Update guest count or package for this order. All changes are logged.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="guestCount" className="text-right">
              Guests
            </Label>
            <Input
              id="guestCount"
              type="number"
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
              className="col-span-3"
              disabled={updateType === 'package'}
              min="1"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="package" className="text-right">
              Package
            </Label>
            <Select
              value={selectedPackageId}
              onValueChange={setSelectedPackageId}
              disabled={updateType === 'guestCount'}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select a package" />
              </SelectTrigger>
              <SelectContent>
                {unlimitedPackages.map((pkg) => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.menuName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-start gap-4">
            <Label htmlFor="reason" className="text-right pt-2">
              Reason
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="col-span-3"
              placeholder="Explain why this change is necessary..."
              required
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
