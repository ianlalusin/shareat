
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { X, Plus, Loader2, WifiOff } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Order, Store, OrderTransaction, ReceiptSettings, OrderItem, Receipt } from '@/lib/types';
import { useFirestore, useAuth } from '@/firebase';
import { collection, serverTimestamp, doc, getDocs, query, where, runTransaction, writeBatch } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { computeTaxFromGross } from '@/lib/tax';
import { useOnlineStatus } from '@/hooks/use-online-status';

interface Payment {
  id: number;
  amount: string;
  method: string;
}

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  store: Store;
  totalAmount: number;
  onFinalizeSuccess: () => void;
}

export function PaymentModal({
  isOpen,
  onClose,
  order,
  store,
  totalAmount,
  onFinalizeSuccess,
}: PaymentModalProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const firestore = useFirestore();
  const auth = useAuth();
  const { toast } = useToast();
  const online = useOnlineStatus();

  const totalPaid = payments.reduce((acc, p) => acc + parseCurrency(p.amount), 0);
  const balance = totalAmount - totalPaid;
  const change = totalPaid > totalAmount ? totalPaid - totalAmount : 0;
  
  const availableMops = store.mopAccepted.filter(mop => !payments.some(p => p.method === mop));

  useEffect(() => {
    if (isOpen) {
      const defaultMethod = store.mopAccepted.includes('Cash') 
        ? 'Cash' 
        : store.mopAccepted[0] || '';

      setPayments([
        {
          id: 1,
          amount: formatCurrency(totalAmount).replace('₱', ''),
          method: defaultMethod,
        },
      ]);
      setErrorMessage(null);
      setIsProcessing(false);
    }
  }, [isOpen, totalAmount, store.mopAccepted]);
  
  const handleAmountChange = (id: number, newAmount: string) => {
    setPayments(
      payments.map(p => (p.id === id ? { ...p, amount: newAmount.replace(/[^0-9.]/g, '') } : p))
    );
  };
  
  const handleAmountBlur = (id: number, value: string) => {
    const numericValue = parseCurrency(value);
    setPayments(
      payments.map(p => p.id === id ? { ...p, amount: formatCurrency(numericValue).replace('₱','') } : p)
    )
  }

  const handleMethodChange = (id: number, newMethod: string) => {
    setPayments(payments.map(p => (p.id === id ? { ...p, method: newMethod } : p)));
  };

  const addPaymentLine = () => {
    if (availableMops.length === 0) return;
    const newId = (payments[payments.length - 1]?.id || 0) + 1;
    const remainingBalance = balance > 0 ? formatCurrency(balance).replace('₱', '') : '0.00';
    setPayments([
      ...payments,
      { id: newId, amount: remainingBalance, method: availableMops[0] },
    ]);
  };
  
  const removePaymentLine = (id: number) => {
    setPayments(payments.filter(p => p.id !== id));
  }
  
  const finalizeBill = async () => {
    if (!firestore || balance > 0.01 || !online) return;
    setIsProcessing(true);
    setErrorMessage(null);
    const user = auth?.currentUser;

    try {
        const tablesRef = collection(firestore, 'tables');
        const q = query(tablesRef, where('storeId', '==', order.storeId), where('activeOrderId', '==', order.id));
        const tableSnapshot = await getDocs(q);
        const tableDoc = tableSnapshot.empty ? null : tableSnapshot.docs[0];

        await runTransaction(firestore, async (transaction) => {
            const orderRef = doc(firestore, 'orders', order.id);
            const orderSnap = await transaction.get(orderRef);
            if (!orderSnap.exists()) throw new Error("Order not found");
            const orderData = orderSnap.data() as Order;
            if (orderData.status === "Completed") throw new Error("This order has already been completed.");

            const settingsRef = doc(firestore, 'receiptSettings', order.storeId);
            const settingsSnap = await transaction.get(settingsRef);
            if (!settingsSnap.exists()) throw new Error("Receipt settings for this store not found!");
            const settings = settingsSnap.data() as ReceiptSettings;
            
            const orderItemsQuery = query(collection(firestore, 'orders', order.id, 'orderItems'));
            const orderItemsSnap = await getDocs(orderItemsQuery);
            const allItems = orderItemsSnap.docs.map(d => d.data() as OrderItem);

            const billableItems = allItems.filter(item => {
                const price = item.priceAtOrder ?? 0;
                const isFree = item.isFree === true || price === 0;
                return !isFree && item.status === 'Served';
            });

            let subtotalGross = 0;
            let subtotalNet = 0;
            let subtotalTax = 0;

            for (const item of billableItems) {
                const gross = item.priceAtOrder * item.quantity;
                const { net, tax } = computeTaxFromGross(gross, item.taxRate);
                subtotalGross += gross;
                subtotalNet += net;
                subtotalTax += tax;
            }

            const adjustments = (await getDocs(collection(firestore, 'orders', order.id, 'transactions'))).docs
                .map(d => d.data() as OrderTransaction)
                .filter(t => t.type === 'Discount' || t.type === 'Charge');
                
            const discountAmount = adjustments.filter(t => t.type === 'Discount').reduce((sum, t) => sum + t.amount, 0);

            const grandTotalGross = subtotalGross - discountAmount;
            
            const receiptRef = doc(collection(firestore, 'receipts'));
            const receiptData: Omit<Receipt, 'id'> = {
                orderId: order.id,
                storeId: order.storeId,
                subtotalGross,
                subtotalNet,
                subtotalTax,
                discountAmount,
                grandTotalGross,
                grandTotalNet: subtotalNet - discountAmount,
                grandTotalTax: subtotalTax,
                createdAt: serverTimestamp(),
                createdByUid: user?.uid || 'unknown',
                createdByName: user?.displayName || user?.email || 'Unknown',
            };
            transaction.set(receiptRef, receiptData);

            const nextNumber = settings.nextReceiptNumber || 1;
            const receiptNumber = `${settings.receiptNumberPrefix || ''}${String(nextNumber).padStart(6, '0')}`;
            
            const receiptDetails = {
                receiptNumber,
                receiptId: receiptRef.id,
                cashierName: user?.displayName || user?.email || 'System',
                cashierUid: user?.uid || null,
                printedAt: serverTimestamp(),
                totalAmount: grandTotalGross,
                totalPaid: totalPaid,
                change: change,
            };

            if (tableDoc) {
                transaction.update(tableDoc.ref, { status: 'Available', activeOrderId: '' });
            }

            const transactionsRef = collection(firestore, 'orders', order.id, 'transactions');
            const paymentSummary: { method: string; amount: number }[] = [];

            payments.forEach(payment => {
                const amount = parseCurrency(payment.amount);
                paymentSummary.push({ method: payment.method, amount });
                const newPaymentRef = doc(transactionsRef);
                const paymentData: Omit<OrderTransaction, 'id'> = {
                    orderId: order.id,
                    storeId: order.storeId,
                    type: 'Payment',
                    amount: amount,
                    method: payment.method,
                    timestamp: serverTimestamp(),
                    cashierUid: user?.uid || null,
                };
                transaction.set(newPaymentRef, paymentData);
            });
            
            transaction.update(orderRef, {
                status: 'Completed',
                receiptId: receiptRef.id,
                completedTimestamp: serverTimestamp(),
                totalAmount: grandTotalGross,
                totalPaid,
                change,
                paymentSummary,
                receiptDetails,
            });

            transaction.update(settingsRef, { nextReceiptNumber: nextNumber + 1 });
        });
      
      onFinalizeSuccess();

    } catch (error) {
      console.error("Failed to finalize bill: ", error);
      setErrorMessage(error instanceof Error ? error.message : "An unknown error occurred during finalization.");
      toast({
          variant: "destructive",
          title: "Finalization Failed",
          description: error instanceof Error ? error.message : "Could not finalize the bill.",
      });
    } finally {
      setIsProcessing(false);
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isProcessing) {
      onClose();
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className='flex justify-between items-center bg-muted p-4 rounded-lg'>
                <span className='text-lg font-semibold'>Total Due</span>
                <span className='text-2xl font-bold font-headline'>{formatCurrency(totalAmount)}</span>
            </div>

            <div className='space-y-3'>
                {payments.map((payment, index) => (
                    <div key={payment.id} className="flex items-center gap-2">
                        <div className="relative flex-grow">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">₱</span>
                            <Input
                                type="text"
                                value={payment.amount}
                                onChange={(e) => handleAmountChange(payment.id, e.target.value)}
                                onBlur={(e) => handleAmountBlur(payment.id, e.target.value)}
                                className="pl-7"
                            />
                        </div>
                        <Select value={payment.method} onValueChange={(val) => handleMethodChange(payment.id, val)}>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Payment Method" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={payment.method}>{payment.method}</SelectItem>
                                {availableMops.map(mop => (
                                    <SelectItem key={mop} value={mop}>{mop}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {payments.length > 1 && (
                            <Button variant="ghost" size="icon" onClick={() => removePaymentLine(payment.id)}>
                                <X className="h-4 w-4"/>
                            </Button>
                        )}
                    </div>
                ))}
            </div>

            {balance > 0.01 && (
                <div className='flex justify-between items-center'>
                    <span className='text-sm text-destructive font-medium'>Balance Remaining: {formatCurrency(balance)}</span>
                    {availableMops.length > 0 && (
                        <Button variant="outline" size="sm" onClick={addPaymentLine}>
                            <Plus className="mr-2 h-4 w-4" /> Split Bill
                        </Button>
                    )}
                </div>
            )}

            {totalPaid > totalAmount && (
                 <div className='flex justify-between items-center bg-green-100 dark:bg-green-900/30 p-3 rounded-lg'>
                    <span className='font-semibold text-green-700 dark:text-green-300'>Change Due</span>
                    <span className='font-bold text-lg text-green-700 dark:text-green-300'>{formatCurrency(change)}</span>
                </div>
            )}
            
            {!online && (
                 <Alert variant="warning">
                  <WifiOff className="h-4 w-4" />
                  <AlertTitle>You are offline</AlertTitle>
                  <AlertDescription>
                    You cannot finalize a bill while offline. Please reconnect to continue.
                  </AlertDescription>
                </Alert>
            )}

            {errorMessage && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Payment Error</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
        </div>
        <DialogFooter className="flex-row justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={finalizeBill}
            disabled={balance > 0.01 || isProcessing || !online}
          >
            {isProcessing ? <Loader2 className="animate-spin" /> : 'Charge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
