
'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Order, OrderItem, OrderTransaction, Store } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, TrendingUp, ChevronRight, Hash, Wallet, Coins, Printer, Undo, Pencil } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { useStoreSelector } from '@/store/use-store-selector';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

function ReceiptViewerModal({ order, store, items, transactions, isOpen, onClose }: { order: Order | null, store: Store | null, items: OrderItem[], transactions: OrderTransaction[], isOpen: boolean, onClose: () => void }) {
    if (!order) return null;

    const [calculatedSubtotal, setCalculatedSubtotal] = useState(0);

    useEffect(() => {
        const subtotal = items.reduce((acc, item) => acc + (item.quantity * item.priceAtOrder), 0);
        setCalculatedSubtotal(subtotal);
    }, [items]);

    const adjustments = transactions.filter(t => t.type === 'Discount' || t.type === 'Charge');
    const payments = transactions.filter(t => t.type === 'Payment');
    const total = calculatedSubtotal + adjustments.reduce((acc, t) => t.type === 'Charge' ? acc + t.amount : acc - t.amount, 0);
    const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
    const change = totalPaid - total;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Receipt Details</DialogTitle>
                </DialogHeader>
                <div className="bg-white text-black p-4 rounded-lg shadow-inner max-h-[60vh] overflow-y-auto">
                    <div className="font-mono text-xs w-full mx-auto">
                        <div className="text-center space-y-1 mb-2">
                            {store?.logo && <div className="flex justify-center mb-2"><img src={store.logo} alt="Store Logo" className="h-16 w-auto object-contain"/></div>}
                            <h2 className="text-sm font-bold">{store?.storeName}</h2>
                            <p>{store?.address}</p>
                            <p>{store?.contactNo}</p>
                            {store?.tinNumber && <p>TIN: {store.tinNumber}</p>}
                        </div>
                        <Separator className="my-2 border-dashed border-black"/>
                        <div className="space-y-1">
                            <p>Receipt No: {order.receiptDetails?.receiptNumber}</p>
                            <p>Date: {order.completedTimestamp ? format(order.completedTimestamp.toDate(), 'MM/dd/yyyy hh:mm a') : 'N/A'}</p>
                            <p>Cashier: {order.receiptDetails?.cashierName}</p>
                        </div>
                        <Separator className="my-2 border-dashed border-black"/>
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
                                        <td className="text-right">{formatCurrency(item.quantity * item.priceAtOrder)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <Separator className="my-2 border-dashed border-black"/>
                        <div className="space-y-1">
                            <div className="flex justify-between"><p>Subtotal:</p><p>{formatCurrency(calculatedSubtotal)}</p></div>
                             {adjustments.map(adj => (
                                <div key={adj.id} className="flex justify-between">
                                    <p>{adj.type} ({adj.notes}):</p>
                                    <p>{adj.type === 'Discount' ? '-' : ''}{formatCurrency(adj.amount)}</p>
                                </div>
                            ))}
                            <div className="flex justify-between font-bold text-sm"><p>TOTAL:</p><p>{formatCurrency(total)}</p></div>
                        </div>
                        <Separator className="my-2 border-dashed border-black"/>
                        <div className="space-y-1">
                           {payments.map(p => (
                               <div key={p.id} className="flex justify-between"><p>{p.method}:</p><p>{formatCurrency(p.amount)}</p></div>
                           ))}
                           <div className="flex justify-between"><p>Total Paid:</p><p>{formatCurrency(totalPaid)}</p></div>
                           {change > 0 && <div className="flex justify-between"><p>Change:</p><p>{formatCurrency(change)}</p></div>}
                        </div>
                    </div>
                </div>
                <DialogFooter className="flex-row justify-end gap-2 mt-4">
                    <Button variant="outline"><Printer className="mr-2 h-4 w-4" />Reprint</Button>
                    <Button variant="outline"><Undo className="mr-2 h-4 w-4" />Return</Button>
                    <Button variant="destructive"><Pencil className="mr-2 h-4 w-4" />Edit</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


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

      // Initial report generation
      handleGenerateReport();

      return () => activeUnsubscribe();
    }
  }, [firestore, selectedStoreId]);


  const handleGenerateReport = async () => {
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
      const startDate = Timestamp.fromDate(startOfDay(dateRange.from));
      const endDate = Timestamp.fromDate(endOfDay(dateRange.to));

      const completedOrdersQuery = query(
        collection(firestore, 'orders'),
        where('storeId', '==', selectedStoreId),
        where('status', '==', 'Completed'),
        where('completedTimestamp', '>=', startDate),
        where('completedTimestamp', '<=', endDate)
      );
      const completedOrdersSnapshot = await getDocs(completedOrdersQuery);
      const completedOrdersData = completedOrdersSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as Order);
      setCompletedOrders(completedOrdersData);

      const orderIds = completedOrdersData.map(o => o.id);

      if (orderIds.length === 0) {
        setTransactions([]);
        setReportData([]);
        setOrderItems([]);
        setLoading(false);
        return;
      }
      
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
      const itemsSnapshot = await getDocs(orderItemsQuery);
      const items = itemsSnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as OrderItem);
      setOrderItems(items);

      const aggregatedData = new Map<string, SalesReportItem>();
      for (const item of items) {
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
  };

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
    const salesByDate: Record<string, number> = {};
    const range = dateRange?.to && dateRange.from ? 
      Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))
      : 7;

    const defaultEndDate = dateRange?.to || new Date();

    for (let i = 0; i < (range > 1 ? range : 7); i++) {
        const date = subDays(defaultEndDate, i);
        const formattedDate = format(date, 'MMM d');
        salesByDate[formattedDate] = 0;
    }

    transactions.filter(t => t.type === 'Payment').forEach(t => {
        if(t.timestamp){
            const date = format(t.timestamp.toDate(), 'MMM d');
            if(date in salesByDate){
                salesByDate[date] += t.amount;
            }
        }
    });
    
    return Object.entries(salesByDate).map(([date, total]) => ({ date, total })).reverse();
  }, [transactions, dateRange]);
  
  const selectedOrderStore = useMemo(() => {
      if (!selectedOrderForView) return null;
      return stores.find(s => s.id === selectedOrderForView.storeId) || null;
  }, [selectedOrderForView, stores]);


  return (
    <>
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Sales Report
        </h1>
        <div className="flex items-center gap-2">
            <DateRangePicker onUpdate={setDateRange} />
            <Button onClick={handleGenerateReport} disabled={loading}>
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
            <Alert>
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
                <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={salesChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                            dataKey="date"
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#888888"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `₱${Number(value) / 1000}k`}
                        />
                         <Tooltip
                            contentStyle={{
                                background: "hsl(var(--background))",
                                border: "1px solid hsl(var(--border))",
                                borderRadius: "var(--radius)",
                            }}
                            labelStyle={{ color: "hsl(var(--foreground))" }}
                            itemStyle={{ fontWeight: "bold" }}
                            formatter={(value) => [formatCurrency(value as number), "Sales"]}
                        />
                        <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
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
    
    <ReceiptViewerModal
        isOpen={!!selectedOrderForView}
        onClose={() => setSelectedOrderForView(null)}
        order={selectedOrderForView}
        store={selectedOrderStore}
        items={orderItems.filter(item => item.orderId === selectedOrderForView?.id)}
        transactions={transactions.filter(trans => trans.orderId === selectedOrderForView?.id)}
    />
    </>
  );
}
