
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Order, OrderItem, RefillItem } from '@/lib/types';
import { OrderTimer } from '../cashier/order-timer';
import { useFirestore, useAuth } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '../ui/badge';

type KitchenItem = (OrderItem | RefillItem) & {
    orderId: string;
};

interface KitchenOrderCardProps {
    order: Order | undefined;
    items: KitchenItem[];
}

export function KitchenOrderCard({ order, items }: KitchenOrderCardProps) {
    const firestore = useFirestore();
    const auth = useAuth();
    const { openSuccessModal } = useSuccessModal();
    const { toast } = useToast();

    const handleServeItem = async (item: KitchenItem) => {
        if (!firestore) return;
        
        // Determine if it's a refill or a regular order item by checking for a unique property
        const isRefill = !('priceAtOrder' in item);
        const collectionName = isRefill ? 'refills' : 'orderItems';
        const user = auth?.currentUser;

        const itemRef = doc(firestore, 'orders', item.orderId, collectionName, item.id);

        try {
            await updateDoc(itemRef, {
                status: 'Served',
                servedAt: serverTimestamp(),
                servedBy: user?.displayName || user?.email || 'Kitchen',
            });
            openSuccessModal();
        } catch (error) {
            toast({
                variant: "destructive",
                title: "Update Failed",
                description: "Could not update the item status.",
            });
        }
    };
    
    if (!order) return null;

  return (
    <Card className="flex flex-col bg-background">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="text-xl font-bold">{order.tableName}</CardTitle>
                <CardDescription className="font-medium">{order.customerName}</CardDescription>
            </div>
            <OrderTimer startTime={order.orderTimestamp} />
        </div>
        {order.kitchenNote && (
            <div className="mt-2 p-2 bg-yellow-100 dark:bg-yellow-900/40 border border-yellow-300 dark:border-yellow-700 rounded-md text-sm">
                <strong>Order Note:</strong> {order.kitchenNote}
            </div>
        )}
      </CardHeader>
      <CardContent className="flex-grow space-y-2">
        {items.map(item => (
            <div key={item.id} className="p-3 rounded-md bg-amber-100 dark:bg-amber-900/30">
                <div className="flex items-center justify-between">
                    <div className="font-semibold">
                        <span className="text-lg">{item.quantity}x</span> {item.menuName}
                    </div>
                    <Button size="sm" onClick={() => handleServeItem(item)}>Serve</Button>
                </div>
                 {item.priority === 'rush' && <Badge variant="destructive" className="mt-1">RUSH</Badge>}
                {item.kitchenNote && <p className="text-xs italic text-red-600 dark:text-red-400 mt-1 pl-1">Note: {item.kitchenNote}</p>}
            </div>
        ))}
      </CardContent>
    </Card>
  );
}
