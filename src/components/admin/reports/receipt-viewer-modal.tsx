
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
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/utils';
import { Order, Store, OrderItem, OrderTransaction } from '@/lib/types';
import { format } from 'date-fns';
import { Printer, Undo, Pencil } from 'lucide-react';

interface ReceiptViewerModalProps {
  order: Order;
  store: Store | null;
  items: OrderItem[];
  transactions: OrderTransaction[];
  isOpen: boolean;
  onClose: () => void;
}

export function ReceiptViewerModal({
  order,
  store,
  items,
  transactions,
  isOpen,
  onClose,
}: ReceiptViewerModalProps) {
  const [calculatedSubtotal, setCalculatedSubtotal] = useState(0);

  useEffect(() => {
    const subtotal = items.reduce(
      (acc, item) => acc + item.quantity * item.priceAtOrder,
      0
    );
    setCalculatedSubtotal(subtotal);
  }, [items]);

  if (!order) {
    return null;
  }

  const adjustments = transactions.filter(
    (t) => t.type === 'Discount' || t.type === 'Charge'
  );
  const payments = transactions.filter((t) => t.type === 'Payment');
  const total =
    calculatedSubtotal +
    adjustments.reduce(
      (acc, t) => (t.type === 'Charge' ? acc + t.amount : acc - t.amount),
      0
    );
  const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
  const change = totalPaid - total;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Receipt Details</DialogTitle>
        </DialogHeader>
        <div className="bg-white text-black p-4 rounded-lg shadow-inner max-h-[60vh] overflow-y-auto">
          <div className="font-mono text-xs w-full mx-auto">
            <div className="text-center space-y-1 mb-2">
              {store?.logo && (
                <div className="flex justify-center mb-2">
                  <img
                    src={store.logo}
                    alt="Store Logo"
                    className="h-16 w-auto object-contain"
                  />
                </div>
              )}
              <h2 className="text-sm font-bold">{store?.storeName}</h2>
              <p>{store?.address}</p>
              <p>{store?.contactNo}</p>
              {store?.tinNumber && <p>TIN: {store.tinNumber}</p>}
            </div>
            <Separator className="my-2 border-dashed border-black" />
            <div className="space-y-1">
              <p>Receipt No: {order.receiptDetails?.receiptNumber}</p>
              <p>
                Date:{' '}
                {order.completedTimestamp
                  ? format(order.completedTimestamp.toDate(), 'MM/dd/yyyy hh:mm a')
                  : 'N/A'}
              </p>
              <p>Cashier: {order.receiptDetails?.cashierName}</p>
            </div>
            <Separator className="my-2 border-dashed border-black" />
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left font-normal">QTY</th>
                  <th className="text-left font-normal">ITEM</th>
                  <th className="text-right font-normal">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.quantity}</td>
                    <td>{item.menuName}</td>
                    <td className="text-right">
                      {formatCurrency(item.quantity * item.priceAtOrder)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Separator className="my-2 border-dashed border-black" />
            <div className="space-y-1">
              <div className="flex justify-between">
                <p>Subtotal:</p>
                <p>{formatCurrency(calculatedSubtotal)}</p>
              </div>
              {adjustments.map((adj) => (
                <div key={adj.id} className="flex justify-between">
                  <p>
                    {adj.type} ({adj.notes}):
                  </p>
                  <p>
                    {adj.type === 'Discount' ? '-' : ''}
                    {formatCurrency(adj.amount)}
                  </p>
                </div>
              ))}
              <div className="flex justify-between font-bold text-sm">
                <p>TOTAL:</p>
                <p>{formatCurrency(total)}</p>
              </div>
            </div>
            <Separator className="my-2 border-dashed border-black" />
            <div className="space-y-1">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <p>{p.method}:</p>
                  <p>{formatCurrency(p.amount)}</p>
                </div>
              ))}
              <div className="flex justify-between">
                <p>Total Paid:</p>
                <p>{formatCurrency(totalPaid)}</p>
              </div>
              {change > 0 && (
                <div className="flex justify-between">
                  <p>Change:</p>
                  <p>{formatCurrency(change)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="flex-row justify-end gap-2 mt-4">
          <Button variant="outline">
            <Printer className="mr-2 h-4 w-4" />
            Reprint
          </Button>
          <Button variant="outline">
            <Undo className="mr-2 h-4 w-4" />
            Return
          </Button>
          <Button variant="destructive">
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
