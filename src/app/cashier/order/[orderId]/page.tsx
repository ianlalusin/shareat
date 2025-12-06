'use client';

import { useState, useEffect } from 'react';
import { useParams, notFound, useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Order, OrderItem } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);

  const firestore = useFirestore();

  useEffect(() => {
    if (!firestore || !orderId) return;

    const orderRef = doc(firestore, 'orders', orderId);
    const orderUnsubscribe = onSnapshot(orderRef, (docSnap) => {
      if (docSnap.exists()) {
        setOrder({ id: docSnap.id, ...docSnap.data() } as Order);
      } else {
        setOrder(null);
      }
      setLoading(false);
    });

    // We'll add fetching for orderItems later
    
    return () => {
      orderUnsubscribe();
    };
  }, [firestore, orderId]);

  if (loading) {
    return (
      <div className="p-4 lg:p-6">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="grid md:grid-cols-3 gap-6">
            <div className='md:col-span-2 space-y-6'>
                 <Skeleton className="h-48 w-full" />
                 <Skeleton className="h-64 w-full" />
            </div>
            <div className='space-y-6'>
                <Skeleton className="h-96 w-full" />
            </div>
        </div>
      </div>
    );
  }

  if (!order) {
    return notFound();
  }
  
  const orderDate = order.orderTimestamp?.toDate();


  return (
    <main className="flex-1 p-4 lg:p-6">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
        <div>
            <h1 className="text-2xl font-semibold font-headline">Order #{order.id.substring(0, 6)}</h1>
             <p className="text-sm text-muted-foreground">
                For {order.customerName} on Table {order.tableLabel}
             </p>
        </div>
      </div>
      
       <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Order Summary</CardTitle>
                </CardHeader>
                 <CardContent>
                    <p>This is where the list of ordered items will go.</p>
                </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
             <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="flex justify-between">
                  <span className="text-muted-foreground">Package</span>
                  <span className="font-medium">{order.packageName}</span>
                </div>
                 <div className="flex justify-between">
                  <span className="text-muted-foreground">Guests</span>
                  <span className="font-medium">{order.guestCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={order.status === 'Active' ? 'default' : 'secondary'} className={order.status === 'Active' ? 'bg-green-500' : ''}>
                    {order.status}
                  </Badge>
                </div>
                 {orderDate && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date</span>
                      <span className="font-medium">{format(orderDate, 'PPpp')}</span>
                    </div>
                 )}
                 <Separator />
                 <div className="flex justify-between text-lg font-semibold">
                  <span>Total</span>
                  <span>{formatCurrency(order.totalAmount)}</span>
                </div>
              </CardContent>
              <CardFooter>
                 <Button className="w-full" size="lg">Finalize Bill</Button>
              </CardFooter>
            </Card>
          </div>
       </div>

    </main>
  );
}
