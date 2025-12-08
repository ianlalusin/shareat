
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
  DocumentChange,
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

    const activeOrdersQuery = query(
      collection(firestore, 'orders'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Active')
    );

    let itemListeners: Unsubscribe[] = [];

    const ordersUnsubscribe = onSnapshot(activeOrdersQuery, (ordersSnapshot) => {
      // Clean up old item listeners before creating new ones
      itemListeners.forEach(unsub => unsub());
      itemListeners = [];
      setItems([]); // Clear current items when order list changes

      const ordersMap = new Map(ordersSnapshot.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() } as Order]));

      if (ordersSnapshot.empty) {
        return;
      }

      ordersSnapshot.docs.forEach(orderDoc => {
        const order = ordersMap.get(orderDoc.id);

        const processChanges = (changes: DocumentChange[], collectionType: 'orderItems' | 'refills') => {
          changes.forEach(change => {
            const itemData = { ...change.doc.data(), id: change.doc.id, orderId: orderDoc.id, order } as KitchenItem;
            
            if (change.type === 'added') {
              setItems(prevItems => [...prevItems, itemData]);
            }
            if (change.type === 'modified') {
              setItems(prevItems => prevItems.map(item => item.id === itemData.id ? itemData : item));
            }
            if (change.type === 'removed') {
              setItems(prevItems => prevItems.filter(item => item.id !== change.doc.id));
            }
          });
        };

        const orderItemsQuery = query(collection(firestore, 'orders', orderDoc.id, 'orderItems'), where('status', '==', 'Pending'));
        const orderItemsUnsubscribe = onSnapshot(orderItemsQuery, (snapshot) => {
          processChanges(snapshot.docChanges(), 'orderItems');
        });
        itemListeners.push(orderItemsUnsubscribe);

        const refillsQuery = query(collection(firestore, 'orders', orderDoc.id, 'refills'), where('status', '==', 'Pending'));
        const refillsUnsubscribe = onSnapshot(refillsQuery, (snapshot) => {
          processChanges(snapshot.docChanges(), 'refills');
        });
        itemListeners.push(refillsUnsubscribe);
      });
    });

    return () => {
      ordersUnsubscribe();
      itemListeners.forEach(unsub => unsub());
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
