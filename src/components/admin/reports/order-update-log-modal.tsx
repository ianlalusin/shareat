
'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFirestore } from '@/firebase';
import { collection, query, where, getDocs, collectionGroup, orderBy, Timestamp, getDoc, doc } from 'firebase/firestore';
import { OrderUpdateLog, Order } from '@/lib/types';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { Loader2, ArrowRight } from 'lucide-react';

interface OrderUpdateLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeId: string;
  dateRange: { from: Date; to: Date };
}

type LogWithOrderDetails = OrderUpdateLog & {
    tableName?: string;
    customerName?: string;
}

export function OrderUpdateLogModal({ isOpen, onClose, storeId, dateRange }: OrderUpdateLogModalProps) {
  const [logs, setLogs] = useState<LogWithOrderDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const firestore = useFirestore();

  useEffect(() => {
    if (!isOpen || !firestore || !storeId || !dateRange) return;

    const fetchLogs = async () => {
      setLoading(true);
      try {
        const startDate = Timestamp.fromDate(dateRange.from);
        const endDate = Timestamp.fromDate(dateRange.to);

        const q = query(
          collectionGroup(firestore, 'orderAudits'),
          where('storeId', '==', storeId),
          where('timestamp', '>=', startDate),
          where('timestamp', '<=', endDate),
          orderBy('timestamp', 'desc')
        );

        const querySnapshot = await getDocs(q);
        const logData = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() } as OrderUpdateLog));
        
        const logsWithDetails: LogWithOrderDetails[] = await Promise.all(
            logData.map(async (log) => {
                const orderRef = doc(firestore, 'orders', log.orderId);
                const orderSnap = await getDoc(orderRef);
                if (orderSnap.exists()) {
                    const orderData = orderSnap.data() as Order;
                    return {
                        ...log,
                        tableName: orderData.tableName,
                        customerName: orderData.customerName,
                    };
                }
                return log;
            })
        );

        setLogs(logsWithDetails);

      } catch (error) {
        console.error("Error fetching order update logs:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [isOpen, firestore, storeId, dateRange]);

  const formatChange = (change: OrderUpdateLog['changes'][0]) => {
      const formatValue = (value: any, field: string) => {
          if (field === 'totalAmount') return formatCurrency(value);
          return value;
      }
      return (
        <span className="flex items-center gap-1">
            {formatValue(change.oldValue, change.field)}
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="font-semibold">{formatValue(change.newValue, change.field)}</span>
        </span>
      );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Order Update Log</DialogTitle>
          <DialogDescription>
            Showing all logged changes to orders within the selected date range.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] -mx-6">
          <ScrollArea className="h-[70vh] px-6">
            {loading ? (
              <div className="flex justify-center items-center h-48">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                No order updates found for this period.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Table/Customer</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) =>
                    log.changes.map((change, index) => (
                        <TableRow key={`${log.id}-${index}`}>
                            <TableCell className="text-xs">
                                {log.timestamp ? format(log.timestamp.toDate(), 'MM/dd/yy hh:mm a') : 'N/A'}
                            </TableCell>
                            <TableCell>
                                <div className="font-medium">{log.tableName}</div>
                                <div className="text-xs text-muted-foreground">{log.customerName}</div>
                            </TableCell>
                            <TableCell className="capitalize font-medium text-xs">
                                {change.field.replace(/([A-Z])/g, ' $1')}
                            </TableCell>
                            <TableCell className="text-xs">{formatChange(change)}</TableCell>
                            <TableCell className="text-xs">{log.updatedByName}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{log.reason}</TableCell>
                        </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
