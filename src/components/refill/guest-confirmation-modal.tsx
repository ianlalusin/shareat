

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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Minus, Plus } from 'lucide-react';
import { Order } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface GuestConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  onConfirm: (order: Order, guestCount: number) => Promise<void>;
}

export function GuestConfirmationModal({
  isOpen,
  onClose,
  order,
  onConfirm,
}: GuestConfirmationModalProps) {
  const [serverGuestCount, setServerGuestCount] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      setServerGuestCount(2);
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (serverGuestCount <= 0) {
      setError('Guest count must be at least 1.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(order, serverGuestCount);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Guests: {order.tableName}</DialogTitle>
          <DialogDescription>
            Verify the number of guests at the table and their order.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Package</p>
            <p className="font-semibold">{order.packageName}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="guest-count-confirm" className="text-base">
              Server's Count
            </Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12"
                onClick={() => setServerGuestCount((c) => Math.max(1, c - 1))}
                disabled={isSubmitting}
              >
                <Minus className="h-5 w-5" />
              </Button>
              <Input
                id="guest-count-confirm"
                type="number"
                value={serverGuestCount}
                onChange={(e) => setServerGuestCount(Number(e.target.value))}
                className="h-12 text-center text-2xl font-bold"
                min="1"
                required
                disabled={isSubmitting}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-12 w-12"
                onClick={() => setServerGuestCount((c) => c + 1)}
                disabled={isSubmitting}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
