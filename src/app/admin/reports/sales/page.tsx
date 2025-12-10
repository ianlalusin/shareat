
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useFirestore } from '@/firebase';
import {
  collectionGroup,
  query,
  where,
  getDocs,
  Timestamp,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { DateRange } from 'react-day-picker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Order, OrderItem, OrderTransaction, Store } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, TrendingUp, Hash, Wallet, Coins } from 'lucide-react';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { useStoreSelector } from '@/store/use-store-selector';
import { ScrollArea } from '@/components/ui/scroll-area';

const ReceiptViewerModal = dynamic(
  () => import('@/components/admin/reports/receipt-viewer-modal').then(mod => mod.ReceiptViewerModal),
  { ssr: false, loading: () => <p>Loading...</p> }
);

const SalesBarChart = dynamic(
    () => import('@/components/admin/reports/sales-bar-chart').then(mod => mod.SalesBarChart),
    { ssr: false, loading: () => <div className="h-[350px] w-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground"/></div> }
);


export default function SalesReportPage() {
  const [reportData, setReportData] = useState<SalesReportItem[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<OrderTransaction[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date())});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [isReceiptsPanelOpen, setIsReceiptsPanelOpen] = useState(false);

  const [selectedOrderForView, setSelectedOrderForView] = useState<Order | null>(null);

  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore) {
      const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        setStores(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as Store));
      });
      return () => storesUnsubscribe();
    }
  }, [firestore]);


  const fetchData = useCallback(async () => {
    if (!firestore || !dateRange || !dateRange.from || !dateRange.to || !selectedStoreId) {
      setError('Please select a store and a valid date range.');
      return;
    }
    setLoading(true);
    setError(null);
    setReportData([]);
    setTransactions([]);
    setCompletedOrders([]);
    setOrderItems([]);

    try {
      const startDate = Timestamp.fromDate(dateRange.from);
      const endDate = Timestamp.fromDate(dateRange.to);

      const completedOrdersQuery = query(
        collection(firestore, 'orders'),
        where('storeId', '==', selectedStoreId),
        where('status', '==', 'Completed'),
        where('completedTimestamp', '>=', startDate),
        where('completedTimestamp', '<=', endDate)
      );
      const completedOrdersSnapshot = await getDocs(completedOrdersQuery);
      const completedOrdersData = completedOrdersSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as Order);
      
      completedOrdersData.sort((a, b) => (b.completedTimestamp?.toMillis() || 0) - (a.completedTimestamp?.toMillis() || 0));

      setCompletedOrders(completedOrdersData);

      if (completedOrdersData.length === 0) {
        setTransactions([]);
        setReportData([]);
        setOrderItems([]);
        setLoading(false);
        return;
      }
      
      const orderIds = completedOrdersData.map(o => o.id);

      const transactionsQuery = query(
        collectionGroup(firestore, 'transactions'),
        where('orderId', 'in', orderIds)
      );
      const transSnapshot = await getDocs(transactionsQuery);
      const transData = transSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as OrderTransaction);
      setTransactions(transData);

      const orderItemsQuery = query(
        collectionGroup(firestore, 'orderItems'),
        where('orderId', 'in', orderIds)
      );
      const orderItemsSnapshot = await getDocs(orderItemsQuery);
      const allItems = orderItemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OrderItem));
      setOrderItems(allItems);

      const aggregatedData = new Map<string, SalesReportItem>();
      for (const item of allItems) {
          const existing = aggregatedData.get(item.menuItemId);
          const saleAmount = item.quantity * item.priceAtOrder;
          if (existing) {
              existing.quantitySold += item.quantity;
              existing.totalSales += saleAmount;
          } else {
              aggregatedData.set(item.menuItemId, {
                  menuItemId: item.menuItemId,
                  menuName: item.menuName,
                  category: 'N/A', // Placeholder
                  quantitySold: item.quantity,
                  totalSales: saleAmount,
              });
          }
      }
      
      const sortedReport = Array.from(aggregatedData.values()).sort((a,b) => b.totalSales - a.totalSales);
      setReportData(sortedReport);

    } catch (e) {
      console.error('Error generating report:', e);
      setError('Failed to generate report. Please check the console for details.');
    } finally {
      setLoading(false);
    }
  }, [firestore, dateRange, selectedStoreId]);


  useEffect(() => {
    if (firestore && selectedStoreId) {
      // Listener for active orders - not tied to date range
      const activeOrdersQuery = query(
        collection(firestore, 'orders'), 
        where('storeId', '==', selectedStoreId),
        where('status', '==', 'Active')
      );
      const activeUnsubscribe = onSnapshot(activeOrdersQuery, (snapshot) => {
        setActiveOrders(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as Order));
      });
      
      return () => activeUnsubscribe();
    }
  }, [firestore, selectedStoreId]);

  useEffect(() => {
      fetchData();
  }, [selectedStoreId, fetchData]);


  const totalRevenue = transactions.filter(t => t.type === 'Payment').reduce((sum, item) => sum + item.amount, 0);
  const totalReceipts = completedOrders.length;
  const parkedSalesAmount = activeOrders.reduce((sum, order) => sum + order.totalAmount, 0);

  const salesByMop = useMemo(() => {
    return transactions.filter(t => t.type === 'Payment').reduce((acc, trans) => {
        if(trans.method){
            acc[trans.method] = (acc[trans.method] || 0) + trans.amount;
        }
        return acc;
    }, {} as Record<string, number>);
  }, [transactions]);
  
  const salesChartData = useMemo(() => {
    if (!dateRange || !dateRange.from || !dateRange.to) return [];
    
    const salesByDate: Record<string, number> = {};
    let currentDate = startOfDay(dateRange.from);

    while (currentDate <= endOfDay(dateRange.to)) {
        const formattedDate = format(currentDate, 'MMM d');
        salesByDate[formattedDate] = 0;
        currentDate = subDays(currentDate, -1);
    }

    transactions.filter(t => t.type === 'Payment').forEach(t => {
        if(t.timestamp){
            const date = format(t.timestamp.toDate(), 'MMM d');
            if(date in salesByDate){
                salesByDate[date] += t.amount;
            }
        }
    });
    
    return Object.entries(salesByDate).map(([date, total]) => ({ date, total }));
  }, [transactions, dateRange]);
  
  const selectedOrderStore = useMemo(() => {
      if (!selectedOrderForView) return null;
      return stores.find(s => s.id === selectedOrderForView.storeId) || null;
  }, [selectedOrderForView, stores]);


  return (
    <>
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Sales Report
        </h1>
        <div className="flex items-center justify-end gap-2">
            <DateRangePicker value={dateRange} onUpdate={setDateRange} />
            <Button onClick={fetchData} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate Report
            </Button>
        </div>
      </div>

       {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}
        
        {!selectedStoreId && (
            <Alert variant="info">
                <AlertTitle>No Store Selected</AlertTitle>
                <AlertDescription>Please select a store to view its sales report.</AlertDescription>
            </Alert>
        )}


      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalRevenue)}</div>
            </CardContent>
        </Card>
        <Sheet open={isReceiptsPanelOpen} onOpenChange={setIsReceiptsPanelOpen}>
          <SheetTrigger asChild>
             <Card className="cursor-pointer hover:bg-muted/50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Receipts</CardTitle>
                    <Hash className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{totalReceipts}</div>
                </CardContent>
            </Card>
          </SheetTrigger>
          <SheetContent className="sm:max-w-md">
             <SheetHeader>
                <SheetTitle>Receipts</SheetTitle>
                <SheetDescription>
                    Showing {completedOrders.length} receipts for the selected period.
                </SheetDescription>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-8rem)] mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Receipt #</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedOrders.map(order => (
                    <TableRow key={order.id} onClick={() => { setSelectedOrderForView(order); setIsReceiptsPanelOpen(false); }} className="cursor-pointer">
                      <TableCell className="text-xs">
                          {order.completedTimestamp ? format(order.completedTimestamp.toDate(), 'MM/dd/yy hh:mm a') : 'N/A'}
                      </TableCell>
                      <TableCell>{order.receiptDetails?.receiptNumber || 'N/A'}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(order.totalAmount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </SheetContent>
        </Sheet>
         <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Orders</CardTitle>
                <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{activeOrders.length}</div>
                <p className="text-xs text-muted-foreground">{formatCurrency(parkedSalesAmount)} parked</p>
            </CardContent>
        </Card>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sales by MOP</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                {Object.keys(salesByMop).length > 0 ? (
                    Object.entries(salesByMop).map(([mop, amount]) => (
                        <div key={mop} className="flex justify-between text-xs">
                            <span className="font-semibold">{mop}</span>
                            <span>{formatCurrency(amount)}</span>
                        </div>
                    ))
                ) : <p className="text-xs text-muted-foreground">No sales data</p>}
            </CardContent>
        </Card>
      </div>

       <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
            <CardHeader>
                <CardTitle>Sales Overview</CardTitle>
            </CardHeader>
            <CardContent className="pl-2">
                <SalesBarChart data={salesChartData} />
            </CardContent>
        </Card>
        <Card className="col-span-4 lg:col-span-3">
             <CardHeader>
                <CardTitle>Item Sales Breakdown</CardTitle>
                 <CardDescription>
                    Top selling items in the selected date range.
                </CardDescription>
            </CardHeader>
             <CardContent>
                {reportData.length > 0 ? (
                    <ScrollArea className="h-96">
                        <Table>
                            <TableHeader>
                            <TableRow>
                                <TableHead>Menu Item</TableHead>
                                <TableHead className="text-right">Qty Sold</TableHead>
                                <TableHead className="text-right">Total Sales</TableHead>
                            </TableRow>
                            </TableHeader>
                            <TableBody>
                            {reportData.map((item) => (
                                <TableRow key={item.menuItemId}>
                                <TableCell className="font-medium">{item.menuName}</TableCell>
                                <TableCell className="text-right">{item.quantitySold}</TableCell>
                                <TableCell className="text-right">{formatCurrency(item.totalSales)}</TableCell>
                                </TableRow>
                            ))}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                ): (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background/50 h-64">
                        <div className="flex flex-col items-center gap-1 text-center">
                             {loading ? (
                                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                             ) : (
                                <>
                                 <h3 className="text-xl font-bold tracking-tight font-headline">
                                    No sales data
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    No items were sold in this period.
                                </p>
                                </>
                             )}
                        </div>
                    </div>
                )}
             </CardContent>
        </Card>
       </div>
    </main>
    {selectedOrderForView && (
      <ReceiptViewerModal
          isOpen={!!selectedOrderForView}
          onClose={() => setSelectedOrderForView(null)}
          order={selectedOrderForView}
          store={selectedOrderStore}
          items={orderItems.filter(item => item.orderId === selectedOrderForView?.id)}
          transactions={transactions.filter(trans => trans.orderId === selectedOrderForView?.id)}
      />
    )}
    </>
  );
}

interface SalesReportItem {
  menuItemId: string;
  menuName: string;
  category: string;
  quantitySold: number;
  totalSales: number;
}
