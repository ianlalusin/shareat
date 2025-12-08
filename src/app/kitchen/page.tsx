
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore } from '@/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  collectionGroup,
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
      const activeOrderIds = activeOrders.map(o => o.id);

      if (activeOrderIds.length === 0) {
        setItems([]);
        return;
      }
      
      const allItems: KitchenItem[] = [];

      // Create a map of orderId to order data for quick lookup
      const ordersMap = new Map(activeOrders.map(o => [o.id, o]));

      // Helper function to process snapshots for items/refills
      const processSnapshot = (snapshot: any, itemType: 'orderItem' | 'refillItem') => {
        snapshot.docChanges().forEach((change: any) => {
          const docData = change.doc.data();
          const orderId = change.doc.ref.parent.parent.id;

          // Only process items that belong to one of the active orders
          if (activeOrderIds.includes(orderId)) {
            const newItem: KitchenItem = {
              ...docData,
              id: change.doc.id,
              orderId: orderId,
              order: ordersMap.get(orderId)
            };

            const existingIndex = allItems.findIndex(i => i.id === newItem.id);

            if (change.type === 'added' || change.type === 'modified') {
              if (existingIndex > -1) {
                allItems[existingIndex] = newItem;
              } else {
                allItems.push(newItem);
              }
            } else if (change.type === 'removed') {
              if (existingIndex > -1) {
                allItems.splice(existingIndex, 1);
              }
            }
          }
        });

         // Filter only for pending items and update the state
        setItems([...allItems].filter(item => item.status === 'Pending'));
      };

      // 2. Listen to subcollections (orderItems and refills)
      const orderItemsQuery = query(
        collectionGroup(firestore, 'orderItems'),
        where('storeId', '==', selectedStoreId)
      );
      const orderItemsUnsubscribe = onSnapshot(orderItemsQuery, (snapshot) => processSnapshot(snapshot, 'orderItem'));

      const refillsQuery = query(
        collectionGroup(firestore, 'refills'),
        where('storeId', '==', selectedStoreId)
      );
      const refillsUnsubscribe = onSnapshot(refillsQuery, (snapshot) => processSnapshot(snapshot, 'refillItem'));
      
      // Return cleanup function
      return () => {
        orderItemsUnsubscribe();
        refillsUnsubscribe();
      };
    });

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
