
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
  getDoc,
  doc,
} from 'firebase/firestore';

import { useFirestore } from '@/firebase';
import { useStoreSelector } from '@/store/use-store-selector';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { Order, OrderItem, MenuItem, RefillItem, InventoryItem, OrderUpdateLog, Store } from '@/lib/types';
import { StatCard } from '@/components/admin/dashboard/stat-card';
import { TopItemsCard, TopItem } from '@/components/admin/dashboard/top-items-card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DashboardSkeleton } from '@/components/admin/dashboard/dashboard-skeleton';
import { TrendingUp, Hash, Timer, PackageX, History, Layers, Sparkles, Loader2 } from 'lucide-react';
import { startOfDay, endOfDay } from 'date-fns';
import { OrderUpdateLogModal } from '@/components/admin/reports/order-update-log-modal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ShiftStats } from '@/ai/flows/shift-summary-flow';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TopCategoriesAccordion, CategorySalesData } from '@/components/admin/reports/top-categories-accordion';


export default function AdminPage() {
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({ from: startOfDay(new Date()), to: endOfDay(new Date()) });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [totalSales, setTotalSales] = React.useState(0);
  const [totalReceipts, setTotalReceipts] = React.useState(0);
  const [avgServingTime, setAvgServingTime] = React.useState(0);
  const [topCategories, setTopCategories] = React.useState<CategorySalesData[]>([]);
  const [lowStockItems, setLowStockItems] = React.useState<TopItem[]>([]);
  const [updateLogCount, setUpdateLogCount] = React.useState(0);
  
  const [isUpdateLogModalOpen, setIsUpdateLogModalOpen] = React.useState(false);
  const [isAiSummaryModalOpen, setIsAiSummaryModalOpen] = React.useState(false);
  const [aiSummary, setAiSummary] = React.useState('');
  const [rawStats, setRawStats] = React.useState<ShiftStats | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = React.useState(false);

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
            const completedOrderMap = new Map(completedOrders.map(o => [o.id, o]));

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
                getDocs(orderItemsQuery),
                getDocs(refillsQuery),
            ]);

            const sales = transSnapshot.docs.reduce((sum, doc) => sum + doc.data().amount, 0);
            setTotalSales(sales);

            const allOrderItems = orderItemsSnapshot.docs.map(doc => doc.data() as OrderItem);
            
            const itemSales: Record<string, { menuItemId: string; menuName: string; category: string; quantity: number; orderIds: Set<string> }> = {};
      
            for (const item of allOrderItems) {
                if(item.isFree || item.sourceTag === 'initial') continue;
                const menuItem = menuMap.get(item.menuItemId);
                const category = menuItem?.category || 'Uncategorized';
                
                if (!itemSales[item.menuItemId]) {
                itemSales[item.menuItemId] = {
                    menuItemId: item.menuItemId,
                    menuName: item.menuName,
                    category: category,
                    quantity: 0,
                    orderIds: new Set(),
                };
                }
                itemSales[item.menuItemId].quantity += item.quantity;
                itemSales[item.menuItemId].orderIds.add(item.orderId);
            }
            
            const categoryMap: Record<string, CategorySalesData> = {};
            for (const item of Object.values(itemSales)) {
                if(!categoryMap[item.category]) {
                    categoryMap[item.category] = { categoryName: item.category, totalQuantity: 0, items: [] };
                }
                categoryMap[item.category].totalQuantity += item.quantity;
                categoryMap[item.category].items.push({
                    itemName: item.menuName,
                    quantity: item.quantity,
                    receipts: Array.from(item.orderIds).map(oid => completedOrderMap.get(oid)?.receiptDetails?.receiptNumber || 'N/A')
                });
            }

            Object.values(categoryMap).forEach(cat => {
                cat.items.sort((a,b) => b.quantity - a.quantity);
            });

            const finalCategorySales = Object.values(categoryMap).sort((a,b) => b.totalQuantity - a.totalQuantity);
            setTopCategories(finalCategorySales);

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
  
  const handleGenerateSummary = async () => {
    if (!selectedStoreId || !dateRange?.from || !dateRange?.to) {
        alert("Please select a store and a valid date range first.");
        return;
    }
    
    setIsGeneratingSummary(true);
    setAiSummary('');
    setRawStats(null);
    setIsAiSummaryModalOpen(true);

    try {
        const response = await fetch('/api/ai/summarize-shift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                storeId: selectedStoreId,
                startTimestamp: dateRange.from.toISOString(),
                endTimestamp: dateRange.to.toISOString(),
            }),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.statusText}`);
        }

        const data = await response.json();
        setAiSummary(data.aiSummary);
        setRawStats(data.rawStats);
    } catch (error) {
        console.error(error);
        setAiSummary("Sorry, I couldn't generate the summary. Please try again.");
    } finally {
        setIsGeneratingSummary(false);
    }
  };
  
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
        <div className="flex flex-wrap items-center justify-end gap-2">
            <DateRangePicker value={dateRange} onUpdate={setDateRange} />
            <Button onClick={fetchData} className="w-auto" disabled={loading}>
                {loading ? 'Generating...' : 'Generate'}
            </Button>
            <Button onClick={handleGenerateSummary} variant="outline" className="w-auto" disabled={loading}>
                 <Sparkles className="mr-2 h-4 w-4" />
                AI Summary
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          <div className="xl:col-span-2">
             <StatCard
                title="Total Sales"
                value={totalSales}
                format="currency"
                icon={<TrendingUp />}
                linkTo="/admin/reports/sales"
            />
          </div>
           <div className="xl:col-span-1">
             <StatCard
                title="Total Receipts"
                value={totalReceipts}
                icon={<Hash />}
                linkTo="/admin/reports/sales"
            />
           </div>
          <div className="xl:col-span-1">
            <StatCard
                title="Avg. Serving Time"
                value={avgServingTime}
                format="custom"
                customFormatter={formatServingTime}
                icon={<Timer />}
                linkTo="/admin/reports/kitchen"
            />
          </div>
           <div className="cursor-pointer xl:col-span-1" onClick={() => setIsUpdateLogModalOpen(true)}>
              <StatCard
                title="Order Updates"
                value={updateLogCount}
                icon={<History />}
              />
           </div>
          <div className="sm:col-span-1 xl:col-span-2">
            <TopItemsCard
                title="Low Stocks Inventory"
                items={lowStockItems}
                icon={<PackageX />}
                linkTo="/admin/inventory"
            />
          </div>
          <Card className="sm:col-span-full xl:col-span-5">
             <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Layers />
                    Top Selling Categories
                </CardTitle>
                 <CardDescription>
                    Top selling à la carte items grouped by category. Click to expand.
                </CardDescription>
            </CardHeader>
             <CardContent>
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : topCategories.length > 0 ? (
                    <TopCategoriesAccordion data={topCategories} />
                ): (
                    <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background/50 h-64">
                        <div className="flex flex-col items-center gap-1 text-center">
                             <h3 className="text-xl font-bold tracking-tight font-headline">
                                No sales data
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                No items were sold in this period.
                            </p>
                        </div>
                    </div>
                )}
             </CardContent>
        </Card>
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

     <Dialog open={isAiSummaryModalOpen} onOpenChange={setIsAiSummaryModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="text-primary h-5 w-5" />
                    AI Shift Summary
                </DialogTitle>
                <DialogDescription>
                    An AI-generated analysis of the selected period.
                </DialogDescription>
            </DialogHeader>
            {isGeneratingSummary ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Analyzing shift data...</p>
                </div>
            ) : (
                <div className="text-sm text-foreground leading-relaxed bg-muted/50 p-4 rounded-md border">
                    {aiSummary}
                </div>
            )}
        </DialogContent>
    </Dialog>
    </>
  );
}
