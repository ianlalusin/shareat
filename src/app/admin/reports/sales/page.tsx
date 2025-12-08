
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Order, OrderItem, OrderTransaction } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, TrendingUp, ChevronRight, Hash, Wallet, Coins } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { DateRangePicker } from '@/components/admin/date-range-picker';

interface SalesReportItem {
  menuItemId: string;
  menuName: string;
  category: string;
  quantitySold: number;
  totalSales: number;
}

interface ChartDataItem {
  date: string;
  total: number;
}


export default function SalesReportPage() {
  const [reportData, setReportData] = useState<SalesReportItem[]>([]);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<OrderTransaction[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date())});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firestore = useFirestore();

  useEffect(() => {
    if (firestore) {
      // Listener for active orders - not tied to date range
      const activeOrdersQuery = query(collection(firestore, 'orders'), where('status', '==', 'Active'));
      const activeUnsubscribe = onSnapshot(activeOrdersQuery, (snapshot) => {
        setActiveOrders(snapshot.docs.map(doc => doc.data() as Order));
      });

      return () => activeUnsubscribe();
    }
  }, [firestore]);


  const handleGenerateReport = async () => {
    if (!firestore || !dateRange || !dateRange.from || !dateRange.to) {
      setError('Please select a valid date range.');
      return;
    }
    setLoading(true);
    setError(null);
    setReportData([]);
    setTransactions([]);

    try {
      const startDate = Timestamp.fromDate(startOfDay(dateRange.from));
      const endDate = Timestamp.fromDate(endOfDay(dateRange.to));

      // Fetch completed order items
      const orderItemsQuery = query(
        collectionGroup(firestore, 'orderItems'),
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate),
      );
      const itemsSnapshot = await getDocs(orderItemsQuery);
      const items = itemsSnapshot.docs.map(doc => doc.data() as OrderItem);
      
      const transactionsQuery = query(
          collectionGroup(firestore, 'transactions'),
          where('timestamp', '>=', startDate),
          where('timestamp', '<=', endDate),
      );
      const transSnapshot = await getDocs(transactionsQuery);
      const transData = transSnapshot.docs.map(doc => doc.data() as OrderTransaction);
      setTransactions(transData);

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
  
  useEffect(() => {
    // Auto-generate report when date range changes
    handleGenerateReport();
  }, [dateRange, firestore]);

  const totalRevenue = transactions.filter(t => t.type === 'Payment').reduce((sum, item) => sum + item.amount, 0);
  const totalReceipts = new Set(transactions.map(t => t.orderId)).size;
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
      Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24)) + 1
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


  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Sales Report
        </h1>
        <DateRangePicker onUpdate={setDateRange} />
      </div>

       {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
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
         <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Receipts</CardTitle>
                <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">{totalReceipts}</div>
            </CardContent>
        </Card>
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
  );
}
