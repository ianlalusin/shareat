
'use client';

import * as React from 'react';
import { DateRange } from 'react-day-picker';
import {
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  collectionGroup,
} from 'firebase/firestore';

import { useFirestore } from '@/firebase';
import { useStoreSelector } from '@/store/use-store-selector';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { Order, OrderItem, OrderTransaction } from '@/lib/types';
import { StatCard } from '@/components/admin/dashboard/stat-card';
import { TopItemsCard, TopItem } from '@/components/admin/dashboard/top-items-card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DashboardSkeleton } from '@/components/admin/dashboard/dashboard-skeleton';
import { TrendingUp, Hash } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';

export default function AdminPage() {
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [totalSales, setTotalSales] = React.useState(0);
  const [totalReceipts, setTotalReceipts] = React.useState(0);
  const [topItems, setTopItems] = React.useState<TopItem[]>([]);

  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();

  const fetchData = React.useCallback(async () => {
    if (!firestore || !selectedStoreId || !dateRange?.from || !dateRange?.to) {
      if(firestore && selectedStoreId) {
        // Reset data if no valid date range
        setTotalSales(0);
        setTotalReceipts(0);
        setTopItems([]);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startDate = Timestamp.fromDate(startOfDay(dateRange.from));
      const endDate = Timestamp.fromDate(endOfDay(dateRange.to));

      const ordersQuery = query(
        collection(firestore, 'orders'),
        where('storeId', '==', selectedStoreId),
        where('status', '==', 'Completed'),
        where('completedTimestamp', '>=', startDate),
        where('completedTimestamp', '<=', endDate)
      );

      const ordersSnapshot = await getDocs(ordersQuery);
      const completedOrders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      
      setTotalReceipts(completedOrders.length);

      if (completedOrders.length === 0) {
        setTotalSales(0);
        setTopItems([]);
        setLoading(false);
        return;
      }
      
      const orderIds = completedOrders.map(o => o.id);

      // Fetch transactions for sales calculation
      const transactionsQuery = query(
        collectionGroup(firestore, 'transactions'),
        where('orderId', 'in', orderIds),
        where('type', '==', 'Payment')
      );
      const transSnapshot = await getDocs(transactionsQuery);
      const sales = transSnapshot.docs.reduce((sum, doc) => sum + (doc.data() as OrderTransaction).amount, 0);
      setTotalSales(sales);

      // Fetch order items for top items calculation
      const orderItemsQuery = query(
        collectionGroup(firestore, 'orderItems'),
        where('orderId', 'in', orderIds)
      );
      const orderItemsSnapshot = await getDocs(orderItemsQuery);
      const allItems = orderItemsSnapshot.docs.map(doc => doc.data() as OrderItem);

      const itemCounts = allItems.reduce((acc, item) => {
        if (item.sourceTag !== 'initial') { // Exclude main packages
            acc[item.menuName] = (acc[item.menuName] || 0) + item.quantity;
        }
        return acc;
      }, {} as Record<string, number>);

      const sortedItems = Object.entries(itemCounts)
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);
      
      setTopItems(sortedItems);

    } catch (e) {
      console.error("Error fetching dashboard data:", e);
      setError("Failed to load dashboard data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [firestore, selectedStoreId, dateRange]);

  React.useEffect(() => {
    if (selectedStoreId) {
      fetchData();
    } else {
      setLoading(false);
      setTotalSales(0);
      setTotalReceipts(0);
      setTopItems([]);
    }
  }, [selectedStoreId, fetchData]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
            <DateRangePicker value={dateRange} onUpdate={setDateRange} className="flex-1 sm:flex-initial" />
            <Button onClick={fetchData} className="w-auto">Generate</Button>
        </div>
      </div>

       {!selectedStoreId ? (
        <Alert variant="info" className="mt-4">
          <AlertTitle>No Store Selected</AlertTitle>
          <AlertDescription>Please select a store to view its dashboard.</AlertDescription>
        </Alert>
      ) : loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            title="Total Sales"
            value={totalSales}
            format="currency"
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
            linkTo="/admin/reports/sales"
          />
          <StatCard
            title="Total Receipts"
            value={totalReceipts}
            icon={<Hash className="h-4 w-4 text-muted-foreground" />}
            linkTo="/admin/reports/sales"
          />
           <TopItemsCard
            title="Top Selling Items"
            items={topItems}
            linkTo="/admin/reports/sales"
          />
        </div>
      )}
    </main>
  );
}
