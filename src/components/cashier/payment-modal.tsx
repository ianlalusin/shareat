
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
import { X, Plus, Loader2 } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Order, Store, OrderTransaction } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { collection, writeBatch, serverTimestamp, doc, getDocs, query, where } from 'firebase/firestore';

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
  const firestore = useFirestore();

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
    setPayments([
      ...payments,
      { id: newId, amount: formatCurrency(balance).replace('₱', ''), method: availableMops[0] },
    ]);
  };
  
  const removePaymentLine = (id: number) => {
    setPayments(payments.filter(p => p.id !== id));
  }
  
  const handleFinalize = async () => {
    if (!firestore || balance > 0) return;
    setIsProcessing(true);

    try {
      const batch = writeBatch(firestore);

      // 1. Add payment transactions to Firestore
      const transactionsRef = collection(firestore, 'orders', order.id, 'transactions');
      payments.forEach(payment => {
        const paymentData: Omit<OrderTransaction, 'id'> = {
          orderId: order.id,
          type: 'Payment',
          amount: parseCurrency(payment.amount),
          method: payment.method,
          timestamp: serverTimestamp(),
        };
        batch.set(doc(transactionsRef), paymentData);
      });
      
      // 2. Update order status to 'Completed'
      const orderRef = doc(firestore, 'orders', order.id);
      batch.update(orderRef, {
          status: 'Completed',
          completedTimestamp: serverTimestamp(),
          totalAmount: totalAmount, // Final total including discounts/charges
      });

      // 3. Update table status to 'Available'
      const tablesRef = collection(firestore, 'tables');
      const q = query(tablesRef, where('storeId', '==', order.storeId), where('activeOrderId', '==', order.id));
      const tableSnapshot = await getDocs(q);
      if (!tableSnapshot.empty) {
          const tableDoc = tableSnapshot.docs[0];
          batch.update(tableDoc.ref, { status: 'Available', activeOrderId: '' });
      }

      await batch.commit();

      // Placeholder for hardware interactions & success UI
      console.log('--- FINALIZATION ACTIONS (STUBBED) ---');
      console.log('Open cash drawer if connected...');
      console.log('Print receipt if printer is available...');
      console.log('------------------------------------');
      
      alert("Payment successful!"); // Temporary success feedback

      onFinalizeSuccess();

    } catch (error) {
      console.error("Failed to finalize bill: ", error);
      alert("An error occurred during finalization. Please check the console.");
    } finally {
      setIsProcessing(false);
    }
  }


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
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
                                {/* Allow current method to be selected */}
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

            {balance > 0.009 && ( // Use small tolerance for float comparison
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
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleFinalize}
            disabled={balance > 0.01 || isProcessing}
            className="w-32"
          >
            {isProcessing ? <Loader2 className="animate-spin" /> : 'Charge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
