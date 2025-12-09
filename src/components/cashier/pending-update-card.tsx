
'use client';

import { useState } from 'react';
import { useFirestore } from '@/firebase';
import { useAuthContext } from '@/context/auth-context';
import { doc, runTransaction, serverTimestamp, collection, getDocs, query, where, limit } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Order, OrderUpdateLog, PendingOrderUpdate } from '@/lib/types';
import { Loader2, Check, X, ArrowRight, User, Package, Hourglass } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface PendingUpdateCardProps {
  update: PendingOrderUpdate & { order: Order };
}

export function PendingUpdateCard({ update }: PendingUpdateCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { order } = update;
  const firestore = useFirestore();
  const { user } = useAuthContext();
  const { toast } = useToast();

  const handleUpdateRequest = async (action: 'accept' | 'reject') => {
    if (!firestore || !user) return;
    
    setIsProcessing(true);
    let reason = '';
    if (action === 'accept') {
        reason = window.prompt(`Reason for accepting this ${update.type} change:`);
        if (!reason) {
            toast({ variant: 'destructive', title: 'Reason Required', description: 'You must provide a reason to accept an update.' });
            setIsProcessing(false);
            return;
        }
    } else {
        reason = `Rejected by ${user.displayName}`;
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const orderRef = doc(firestore, 'orders', order.id);
        const updateRef = doc(firestore, `orders/${order.id}/pendingUpdates`, update.id);
        const auditLogRef = doc(collection(firestore, 'orders', order.id, 'orderAudits'));

        if (action === 'accept') {
          const updatesToApply: Partial<Order> = {};
          update.changes.forEach(change => {
            (updatesToApply as any)[change.field] = change.newValue;
          });

          // This logic might need access to the full menu, which isn't passed here.
          // For now, we assume the update logic doesn't need external data like menu prices.
          // A more robust solution would involve fetching menu details if needed.
          
          transaction.update(orderRef, updatesToApply);
          
          const auditLog: Omit<OrderUpdateLog, 'id'> = {
            orderId: order.id,
            storeId: order.storeId,
            timestamp: serverTimestamp() as any,
            updatedByUid: user.uid,
            updatedByName: user.displayName || user.email!,
            reason: `Accepted: ${reason}. (Initiated by: ${update.initiatedByName})`,
            changes: update.changes,
          };
          transaction.set(auditLogRef, auditLog);
        }
        
        transaction.delete(updateRef);
      });

      toast({ title: `Update ${action === 'accept' ? 'Accepted' : 'Rejected'}`, description: `The requested change has been ${action}ed.` });

    } catch (error) {
      console.error("Error processing update request:", error);
      toast({ variant: 'destructive', title: 'Action Failed', description: 'Could not process the update request.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const getChangeIcon = (field: string) => {
    if (field === 'guestCount') return <User className="h-4 w-4 mr-2" />;
    if (field === 'packageName') return <Package className="h-4 w-4 mr-2" />;
    return <Hourglass className="h-4 w-4 mr-2" />;
  }

  return (
    <Card className="bg-amber-50 dark:bg-amber-900/20 border-amber-500/50">
        <CardHeader className="pb-3">
            <div className="flex justify-between items-start">
                <div>
                    <CardTitle className="text-lg">Table {order.tableName}</CardTitle>
                    <CardDescription>Customer: {order.customerName || 'N/A'}</CardDescription>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                    <p>Requested by: {update.initiatedByName}</p>
                    <p>{format(update.initiatedAt.toDate(), 'MM/dd/yy hh:mm a')}</p>
                </div>
            </div>
        </CardHeader>
        <CardContent className="space-y-3">
            <div className="space-y-2 rounded-md border bg-background/50 p-3">
                {update.changes.map((change, index) => (
                    <div key={index} className="flex items-center text-sm">
                        {getChangeIcon(change.field)}
                        <span className="font-medium capitalize">{change.field.replace(/([A-Z])/g, ' $1')}:</span>
                        <span className="mx-2 text-muted-foreground line-through">{change.oldValue}</span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground"/>
                        <span className="ml-2 font-semibold text-primary">{change.newValue}</span>
                    </div>
                ))}
            </div>
             <p className="text-xs italic text-muted-foreground p-2 bg-background/30 rounded-md">
                <strong>Reason:</strong> {update.reason}
             </p>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
            <Button
                size="sm"
                variant="destructive"
                onClick={() => handleUpdateRequest('reject')}
                disabled={isProcessing}
            >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin"/> : <X className="h-4 w-4"/>}
                <span className="ml-2">Reject</span>
            </Button>
            <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => handleUpdateRequest('accept')}
                disabled={isProcessing}
            >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin"/> : <Check className="h-4 w-4"/>}
                 <span className="ml-2">Accept</span>
            </Button>
        </CardFooter>
    </Card>
  );
}
