
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore } from '@/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { OrderItem, RefillItem, Order } from '@/lib/types';
import { KitchenOrderCard } from '@/components/kitchen/order-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type KitchenItem = (OrderItem | RefillItem) & {
    orderId: string;
    order?: Order;
};

export default function KitchenPage() {
  const [items, setItems] = useState<KitchenItem[]>([]);
  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setItems([]);
      return;
    }

    // 1. Listen for active orders in the current store
    const activeOrdersQuery = query(
      collection(firestore, 'orders'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Active')
    );

    const ordersUnsubscribe = onSnapshot(activeOrdersQuery, (ordersSnapshot) => {
      const activeOrders = ordersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      
      // An object to hold all items from all active orders
      let allItems: Record<string, KitchenItem> = {};
      
      // An array to hold all unsubscribe functions for item/refill listeners
      let itemListeners: Unsubscribe[] = [];

      if (activeOrders.length === 0) {
        setItems([]);
        return;
      }
      
      // Create a map of orderId to order data for quick lookup
      const ordersMap = new Map(activeOrders.map(o => [o.id, o]));
      
      // 2. For each active order, listen to its subcollections
      activeOrders.forEach(order => {
        const orderId = order.id;

        // Listen to orderItems
        const orderItemsQuery = query(collection(firestore, 'orders', orderId, 'orderItems'), where('status', '==', 'Pending'));
        const orderItemsUnsubscribe = onSnapshot(orderItemsQuery, (snapshot) => {
            snapshot.docs.forEach(doc => {
                 const itemData = { ...doc.data(), id: doc.id, orderId, order: ordersMap.get(orderId) } as KitchenItem;
                 allItems[itemData.id] = itemData;
            });
            // Update state with the new aggregated list
            setItems(Object.values(allItems));
        });
        itemListeners.push(orderItemsUnsubscribe);

        // Listen to refills
        const refillsQuery = query(collection(firestore, 'orders', orderId, 'refills'), where('status', '==', 'Pending'));
        const refillsUnsubscribe = onSnapshot(refillsQuery, (snapshot) => {
            snapshot.docs.forEach(doc => {
                const itemData = { ...doc.data(), id: doc.id, orderId, order: ordersMap.get(orderId) } as KitchenItem;
                allItems[itemData.id] = itemData;
            });
             // Update state with the new aggregated list
            setItems(Object.values(allItems));
        });
        itemListeners.push(refillsUnsubscribe);
      });
      
      // Cleanup function for when active orders change
      return () => {
        itemListeners.forEach(unsub => unsub());
      };
    });

    // Main cleanup function
    return () => {
      ordersUnsubscribe();
      setItems([]);
    };
  }, [firestore, selectedStoreId]);
  
  const groupedByOrder = useMemo(() => {
    const groups: { [key: string]: { order: Order | undefined, items: KitchenItem[] } } = {};
    items.forEach(item => {
        if (!groups[item.orderId]) {
            groups[item.orderId] = {
                order: item.order,
                items: []
            };
        }
        groups[item.orderId].items.push(item);
    });
    return Object.values(groups).sort((a,b) => (a.order?.orderTimestamp.toMillis() || 0) - (b.order?.orderTimestamp.toMillis() || 0));
  }, [items]);

  const hotItems = groupedByOrder
    .map(group => ({
        ...group,
        items: group.items.filter(item => item.targetStation === 'Hot'),
    }))
    .filter(group => group.items.length > 0);

  const coldItems = groupedByOrder
    .map(group => ({
        ...group,
        items: group.items.filter(item => item.targetStation === 'Cold'),
    }))
    .filter(group => group.items.length > 0);

   if (!selectedStoreId) {
        return (
            <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
                 <Alert className="max-w-md bg-background">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store from the header to view kitchen orders.</AlertDescription>
                </Alert>
            </div>
        )
    }

  return (
    <Tabs defaultValue="hot" className="flex flex-col flex-1">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="hot">Hot Station</TabsTrigger>
        <TabsTrigger value="cold">Cold Station</TabsTrigger>
      </TabsList>
      <TabsContent value="hot" className="flex-1 mt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {hotItems.map(group => (
            <KitchenOrderCard key={group.order?.id} order={group.order} items={group.items} />
          ))}
          {hotItems.length === 0 && <p className="text-muted-foreground col-span-full text-center">No pending items for the hot station.</p>}
        </div>
      </TabsContent>
      <TabsContent value="cold" className="flex-1 mt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
           {coldItems.map(group => (
            <KitchenOrderCard key={group.order?.id} order={group.order} items={group.items} />
          ))}
          {coldItems.length === 0 && <p className="text-muted-foreground col-span-full text-center">No pending items for the cold station.</p>}
        </div>
      </TabsContent>
    </Tabs>
  );
}
