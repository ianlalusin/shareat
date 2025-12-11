
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
  limit,
} from 'firebase/firestore';

import { useFirestore } from '@/firebase';
import { useStoreSelector } from '@/store/use-store-selector';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { Order, OrderItem, MenuItem, RefillItem, InventoryItem, OrderUpdateLog } from '@/lib/types';
import { StatCard } from '@/components/admin/dashboard/stat-card';
import { TopItemsCard, TopItem } from '@/components/admin/dashboard/top-items-card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DashboardSkeleton } from '@/components/admin/dashboard/dashboard-skeleton';
import { TrendingUp, Hash, Timer, PackageX, History, Layers } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';
import { OrderUpdateLogModal } from '@/components/admin/reports/order-update-log-modal';

interface TopCategory {
    name: string;
    quantity: number;
}

export default function AdminPage() {
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [totalSales, setTotalSales] = React.useState(0);
  const [totalReceipts, setTotalReceipts] = React.useState(0);
  const [avgServingTime, setAvgServingTime] = React.useState(0);
  const [topCategories, setTopCategories] = React.useState<TopCategory[]>([]);
  const [lowStockItems, setLowStockItems] = React.useState<TopItem[]>([]);
  const [updateLogCount, setUpdateLogCount] = React.useState(0);
  
  const [isUpdateLogModalOpen, setIsUpdateLogModalOpen] = React.useState(false);

  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();

  const fetchData = React.useCallback(async () => {
    if (!firestore || !selectedStoreId) {
      if(firestore && selectedStoreId) {
        setTotalSales(0);
        setTotalReceipts(0);
        setAvgServingTime(0);
        setTopCategories([]);
        setLowStockItems([]);
        setUpdateLogCount(0);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const startDate = dateRange?.from ? Timestamp.fromDate(dateRange.from) : null;
      const endDate = dateRange?.to ? Timestamp.fromDate(dateRange.to) : null;

      // === Sales & Operations Data (Date-ranged) ===
      if (startDate && endDate) {
        const ordersQuery = query(
          collection(firestore, 'orders'),
          where('storeId', '==', selectedStoreId),
          where('status', '==', 'Completed'),
          where('completedTimestamp', '>=', startDate),
          where('completedTimestamp', '<=', endDate)
        );
        
        const menuQuery = query(collection(firestore, 'menu'), where('storeId', '==', selectedStoreId));
        
        const auditLogsQuery = query(
          collectionGroup(firestore, 'orderAudits'),
          where('storeId', '==', selectedStoreId),
          where('timestamp', '>=', startDate),
          where('timestamp', '<=', endDate)
        );

        const [ordersSnapshot, menuSnapshot, auditLogsSnapshot] = await Promise.all([
          getDocs(ordersQuery),
          getDocs(menuQuery),
          getDocs(auditLogsQuery),
        ]);
        
        const menuItems = menuSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem));
        const menuMap = new Map(menuItems.map(item => [item.id, item]));

        const completedOrders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
        
        setTotalReceipts(completedOrders.length);
        setUpdateLogCount(auditLogsSnapshot.size);

        if (completedOrders.length > 0) {
            const orderIds = completedOrders.map(o => o.id);

            const transactionsQuery = query(
                collectionGroup(firestore, 'transactions'),
                where('orderId', 'in', orderIds),
                where('type', '==', 'Payment')
            );
            
            const orderItemsQuery = query(
                collectionGroup(firestore, 'orderItems'),
                where('orderId', 'in', orderIds)
            );
            
            const refillsQuery = query(
                collectionGroup(firestore, 'refills'),
                where('orderId', 'in', orderIds)
            );

            const [transSnapshot, orderItemsSnapshot, refillsSnapshot] = await Promise.all([
                getDocs(transactionsQuery),
                getDocs(orderItemsSnapshot),
                getDocs(refillsQuery),
            ]);

            const sales = transSnapshot.docs.reduce((sum, doc) => sum + doc.data().amount, 0);
            setTotalSales(sales);

            const allOrderItems = orderItemsSnapshot.docs.map(doc => doc.data() as OrderItem);
            
            const categorySales: Record<string, { name: string, quantity: number }> = {};
            allOrderItems.forEach(item => {
                if(item.sourceTag === 'initial') return;
                
                const menuItem = menuMap.get(item.menuItemId);
                const category = menuItem?.category || 'Uncategorized';
                
                if (!categorySales[category]) {
                    categorySales[category] = { name: category, quantity: 0 };
                }
                
                categorySales[category].quantity += item.quantity;
            });

            const sortedCategories = Object.values(categorySales)
                .sort((a, b) => b.quantity - a.quantity)
                .slice(0, 5);
            setTopCategories(sortedCategories);
            
            const allRefills = refillsSnapshot.docs.map(doc => doc.data() as RefillItem);
            const servedItems = [...allOrderItems, ...allRefills].filter(
                item => item.status === 'Served' && item.timestamp && item.servedTimestamp
            );
            
            if (servedItems.length > 0) {
                const totalServingMillis = servedItems.reduce((sum, item) => {
                    const created = item.timestamp!.toMillis();
                    const served = item.servedTimestamp!.toMillis();
                    return sum + (served - created);
                }, 0);
                const avgMillis = totalServingMillis / servedItems.length;
                setAvgServingTime(avgMillis / 1000);
            } else {
                setAvgServingTime(0);
            }
        } else {
            setTotalSales(0);
            setTopCategories([]);
            setAvgServingTime(0);
        }
      } else {
        setTotalSales(0);
        setTotalReceipts(0);
        setAvgServingTime(0);
        setTopCategories([]);
        setUpdateLogCount(0);
      }
      
      // === Inventory Data (Not date-ranged) ===
      const inventoryQuery = query(
        collection(firestore, 'inventory'),
        where('storeId', '==', selectedStoreId),
        where('trackInventory', '==', true)
      );
      
      const inventorySnapshot = await getDocs(inventoryQuery);
      const lowItems = inventorySnapshot.docs
        .map(doc => doc.data() as InventoryItem)
        .filter(item => item.currentQty <= item.reorderPoint)
        .sort((a,b) => a.currentQty - b.currentQty) // Sort by lowest quantity first
        .slice(0, 5)
        .map(item => ({ name: item.name, quantity: item.currentQty }));

      setLowStockItems(lowItems);

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
      setAvgServingTime(0);
      setTopCategories([]);
      setLowStockItems([]);
      setUpdateLogCount(0);
    }
  }, [selectedStoreId, fetchData]);
  
  const formatServingTime = (seconds: number) => {
      if (seconds < 60) return `${Math.round(seconds)}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = Math.round(seconds % 60);
      return `${minutes}m ${remainingSeconds}s`;
  }

  return (
    <>
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Dashboard
        </h1>
        <div className="flex items-center justify-end gap-2">
            <DateRangePicker value={dateRange} onUpdate={setDateRange} />
            <Button onClick={fetchData} className="w-auto" disabled={loading}>
                {loading ? 'Generating...' : 'Generate'}
            </Button>
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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
          <StatCard
            title="Avg. Serving Time"
            value={avgServingTime}
            format="custom"
            customFormatter={formatServingTime}
            icon={<Timer className="h-4 w-4 text-muted-foreground" />}
            linkTo="/admin/reports/kitchen"
          />
           <div onClick={() => setIsUpdateLogModalOpen(true)} className="cursor-pointer">
              <StatCard
                title="Order Updates"
                value={updateLogCount}
                icon={<History className="h-4 w-4 text-muted-foreground" />}
              />
           </div>
          <TopItemsCard
            title="Low Stocks Inventory"
            items={lowStockItems}
            icon={<PackageX className="h-4 w-4 text-muted-foreground" />}
            linkTo="/admin/inventory"
          />
           <TopItemsCard
            title="Top Selling Categories"
            items={topCategories}
            icon={<Layers className="h-4 w-4 text-muted-foreground" />}
            linkTo="/admin/reports/sales"
          />
        </div>
      )}
    </main>
    
     {isUpdateLogModalOpen && selectedStoreId && dateRange && dateRange.from && dateRange.to && (
        <OrderUpdateLogModal
            isOpen={isUpdateLogModalOpen}
            onClose={() => setIsUpdateLogModalOpen(false)}
            storeId={selectedStoreId}
            dateRange={dateRange as { from: Date; to: Date; }}
        />
     )}
    </>
  );
}
