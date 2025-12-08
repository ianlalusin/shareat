
'use client';

import { useState } from 'react';
import { useFirestore } from '@/firebase';
import {
  collectionGroup,
  query,
  where,
  getDocs,
  Timestamp,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRangePicker } from '@/components/admin/date-range-picker';
import { formatCurrency } from '@/lib/utils';
import { OrderItem, Product } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface SalesReportItem {
  menuItemId: string;
  menuName: string;
  category: string;
  quantitySold: number;
  totalSales: number;
}

export default function SalesReportPage() {
  const [reportData, setReportData] = useState<SalesReportItem[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firestore = useFirestore();

  const handleGenerateReport = async () => {
    if (!firestore || !dateRange || !dateRange.from || !dateRange.to) {
      setError('Please select a valid date range.');
      return;
    }
    setLoading(true);
    setError(null);
    setReportData([]);

    try {
      // Fetch all completed order items within the date range
      const startDate = Timestamp.fromDate(dateRange.from);
      const endDate = Timestamp.fromDate(new Date(dateRange.to.setHours(23, 59, 59, 999)));

      const orderItemsQuery = query(
        collectionGroup(firestore, 'orderItems'),
        where('timestamp', '>=', startDate),
        where('timestamp', '<=', endDate)
      );

      const querySnapshot = await getDocs(orderItemsQuery);
      const items = querySnapshot.docs.map(doc => doc.data() as OrderItem);

      // Aggregate the data
      const aggregatedData = new Map<string, SalesReportItem>();

      for (const item of items) {
        // We only want to include items from completed orders, but we can't query subcollections based on parent doc fields.
        // A more scalable solution would be a denormalized `orderStatus` field on the item itself
        // or using cloud functions. For now, we assume all fetched items are from relevant orders.
        // This is a simplification for this context.

        const existing = aggregatedData.get(item.menuItemId);
        const saleAmount = item.quantity * item.priceAtOrder;

        if (existing) {
          existing.quantitySold += item.quantity;
          existing.totalSales += saleAmount;
        } else {
          // In a real app, you might want to fetch product details here to get the category
          // For simplicity, we'll use a placeholder or assume it's on the order item.
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
  
    const totalRevenue = reportData.reduce((sum, item) => sum + item.totalSales, 0);
    const totalItemsSold = reportData.reduce((sum, item) => sum + item.quantitySold, 0);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Sales Report
        </h1>
        <div className="flex items-center gap-2">
          <DateRangePicker onUpdate={setDateRange} />
          <Button onClick={handleGenerateReport} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Generate
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Report Summary</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {reportData.length === 0 && !loading && !error && (
             <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background/50 h-64">
                <div className="flex flex-col items-center gap-1 text-center">
                    <h3 className="text-2xl font-bold tracking-tight font-headline">
                        No data to display
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        Select a date range and click "Generate" to see your sales report.
                    </p>
                </div>
            </div>
          )}

          {loading && (
             <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
             </div>
          )}
          
          {reportData.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Menu Item</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Quantity Sold</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((item) => (
                    <TableRow key={item.menuItemId}>
                      <TableCell className="font-medium">{item.menuName}</TableCell>
                      <TableCell>{item.category}</TableCell>
                      <TableCell className="text-right">{item.quantitySold}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.totalSales)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
       {reportData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Grand Totals</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <p className="text-sm font-medium">Total Items Sold</p>
                    <p className="text-2xl font-bold">{totalItemsSold}</p>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <p className="text-sm font-medium">Total Revenue</p>
                    <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
                </div>
            </CardContent>
          </Card>
        )}
    </main>
  );
}
