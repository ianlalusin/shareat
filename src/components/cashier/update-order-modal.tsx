
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
import { Order, MenuItem, PendingOrderUpdate } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { useAuthContext } from '@/context/auth-context';
import { doc, serverTimestamp, collection, addDoc, query, where, getDocs } from 'firebase/firestore';
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
      const pendingUpdateRef = collection(firestore, 'orders', order.id, 'pendingUpdates');
      // Check if there's already a pending update
      const q = query(pendingUpdateRef);
      const existingUpdates = await getDocs(q);
      if (!existingUpdates.empty) {
        toast({ variant: 'destructive', title: 'Existing Request', description: 'There is already a pending update request for this order. Please wait for the cashier to review it.' });
        setIsSubmitting(false);
        onClose();
        return;
      }
      
      const changes: PendingOrderUpdate['changes'] = [];
      const newPackage = menu.find(m => m.id === selectedPackageId);

      if (updateType === 'guestCount' && guestCount !== order.guestCount) {
        changes.push({ field: 'guestCount', oldValue: order.guestCount, newValue: guestCount });
      }

      if (updateType === 'package' && newPackage && newPackage.menuName !== order.packageName) {
        changes.push({ field: 'packageName', oldValue: order.packageName, newValue: newPackage.menuName });
      }

      if (changes.length === 0) {
        toast({ title: 'No changes detected.' });
        setIsSubmitting(false);
        onClose();
        return;
      }
      
      const newUpdate: Omit<PendingOrderUpdate, 'id'> = {
        initiatedByUid: user.uid,
        initiatedByName: user.displayName || user.email!,
        initiatedAt: serverTimestamp() as any,
        status: 'pending',
        type: updateType,
        changes: changes,
        reason: reason,
      };

      await addDoc(pendingUpdateRef, newUpdate);
      
      toast({ title: 'Request Submitted', description: 'Your update request has been sent to the cashier for approval.' });
      onClose();

    } catch (error) {
       console.error('Error creating pending update:', error);
      toast({
        variant: 'destructive',
        title: 'Request failed',
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
          <DialogTitle>Request Order Update</DialogTitle>
          <DialogDescription>
            Request a change to the guest count or package. This will require cashier approval.
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
              disabled={updateType === 'package' || isSubmitting}
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
              disabled={updateType === 'guestCount' || isSubmitting}
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
              disabled={isSubmitting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
