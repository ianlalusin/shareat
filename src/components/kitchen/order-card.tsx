
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Order, OrderItem, RefillItem } from '@/lib/types';
import { OrderTimer } from '../cashier/order-timer';
import { useFirestore } from '@/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';

type KitchenItem = (OrderItem | RefillItem) & {
    orderId: string;
};

interface KitchenOrderCardProps {
    order: Order | undefined;
    items: KitchenItem[];
}

export function KitchenOrderCard({ order, items }: KitchenOrderCardProps) {
    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();
    const { toast } = useToast();

    const handleServeItem = async (item: KitchenItem) => {
        if (!firestore) return;
        
        // Determine if it's a refill or a regular order item by checking for a unique property
        const isRefill = 'priceAtOrder' in item ? false : true;
        const collectionName = isRefill ? 'refills' : 'orderItems';

        const itemRef = doc(firestore, 'orders', item.orderId, collectionName, item.id);

        try {
            await updateDoc(itemRef, {
                status: 'Served',
                servedTimestamp: serverTimestamp()
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
                <CardTitle className="text-xl font-bold">{order.tableLabel}</CardTitle>
                <CardDescription className="font-medium">{order.customerName}</CardDescription>
            </div>
            <OrderTimer startTime={order.orderTimestamp} />
        </div>
      </CardHeader>
      <CardContent className="flex-grow space-y-2">
        {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-3 rounded-md bg-amber-100 dark:bg-amber-900/30">
                <div className="font-semibold">
                    <span className="text-lg">{item.quantity}x</span> {item.menuName}
                </div>
                <Button size="sm" onClick={() => handleServeItem(item)}>Serve</Button>
            </div>
        ))}
      </CardContent>
    </Card>
  );
}
