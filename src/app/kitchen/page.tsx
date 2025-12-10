

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
  updateDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Order, OrderItem, RefillItem, GListItem } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { KitchenItem, KitchenOrderCard } from '@/components/kitchen/order-card';
import { cn } from '@/lib/utils';

export default function KitchenPage() {
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [kitchenItemsByOrder, setKitchenItemsByOrder] = useState<Record<string, KitchenItem[]>>({});
  const [storeStations, setStoreStations] = useState<GListItem[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>();
  
  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setStoreStations([]);
      setActiveOrders([]);
      setKitchenItemsByOrder({});
      setActiveTab(undefined);
      return;
    }

    const stationsQuery = query(
      collection(firestore, 'lists'),
      where('category', '==', 'store stations'),
      where('is_active', '==', true),
      where('storeIds', 'array-contains', selectedStoreId)
    );
    const unsubStations = onSnapshot(stationsQuery, (snapshot) => {
        const stationData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GListItem);
        stationData.sort((a,b) => a.item.localeCompare(b.item));
        setStoreStations(stationData);
        if (stationData.length > 0 && !activeTab) {
            setActiveTab(stationData[0].item);
        } else if (stationData.length === 0) {
            setActiveTab(undefined);
        }
    });

    return () => unsubStations();
  }, [firestore, selectedStoreId]);

  useEffect(() => {
    if (!firestore || !selectedStoreId) return;

    const ordersQuery = query(
      collection(firestore, 'orders'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Active')
    );

    const unsubOrders = onSnapshot(ordersQuery, (snapshot) => {
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      setActiveOrders(orders);
    });

    return () => unsubOrders();
  }, [firestore, selectedStoreId]);


  useEffect(() => {
    if (!firestore || activeOrders.length === 0) {
        setKitchenItemsByOrder({});
        return;
    };

    const unsubscribers = activeOrders.map(order => {
      const orderItemsQuery = query(
        collection(firestore, `orders/${order.id}/orderItems`),
        where('status', '==', 'Pending')
      );
      const refillsQuery = query(
        collection(firestore, `orders/${order.id}/refills`),
        where('status', '==', 'Pending')
      );

      const unsubOrderItems = onSnapshot(orderItemsQuery, (snapshot) => {
        const items = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as OrderItem),
          orderId: order.id,
          sourceCollection: 'orderItems',
          ref: docSnap.ref,
        }));
        setKitchenItemsByOrder(prev => ({
          ...prev,
          [order.id]: [
            ...(prev[order.id]?.filter(i => i.sourceCollection !== 'orderItems') || []),
            ...items,
          ],
        }));
      });

      const unsubRefills = onSnapshot(refillsQuery, (snapshot) => {
        const items = snapshot.docs.map(docSnap => ({
          id: docSnap.id,
          ...(docSnap.data() as RefillItem),
          orderId: order.id,
          sourceCollection: 'refills',
          ref: docSnap.ref,
        }));
        setKitchenItemsByOrder(prev => ({
          ...prev,
          [order.id]: [
            ...(prev[order.id]?.filter(i => i.sourceCollection !== 'refills') || []),
            ...items,
          ],
        }));
      });

      return [unsubOrderItems, unsubRefills];
    });

    return () => {
      unsubscribers.flat().forEach(unsub => unsub());
    };
  }, [firestore, activeOrders]);


  const groupedByOrder = useMemo(() => {
    return activeOrders
      .map(order => ({
        orderId: order.id,
        order: order,
        items: kitchenItemsByOrder[order.id] || [],
      }))
      .filter(group => group.items.length > 0)
      .sort((a, b) => {
        const pa = a.order?.priority === 'rush' ? 1 : 0;
        const pb = b.order?.priority === 'rush' ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (
          (a.order?.orderTimestamp?.toMillis?.() || 0) -
          (b.order?.orderTimestamp?.toMillis?.() || 0)
        );
      });
  }, [activeOrders, kitchenItemsByOrder]);

  
  const getGroupsForStation = (station: string) => {
      return groupedByOrder
        .map((group) => ({
          ...group,
          items: group.items.filter((i) => i.targetStation === station),
        }))
        .filter((g) => g.items.length > 0);
  }
  
  const handleServeItem = async (item: KitchenItem) => {
    if (!firestore) return;
    
    await updateDoc(item.ref, {
        status: 'Served',
        servedTimestamp: serverTimestamp(),
    });
  };

  const handleServeAll = async (groupItems: KitchenItem[]) => {
    if (!firestore || groupItems.length === 0) return;
    try {
      const batch = writeBatch(firestore);
      
      groupItems.forEach((item) => {
        batch.update(item.ref, {
          status: 'Served',
          servedTimestamp: serverTimestamp(),
        });
      });

      await batch.commit();
      toast({
        title: "All items served!",
      });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to mark all items as served.',
      });
    }
  };

  if (!selectedStoreId) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center p-4">
        <Alert variant="info" size="sm" className="max-w-md">
          <AlertTitle>No Store Selected</AlertTitle>
          <AlertDescription>
            Please select a store from the header to view kitchen orders.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1">
      <TabsList className="h-auto flex-wrap justify-start">
        {storeStations.map(station => (
            <TabsTrigger key={station.id} value={station.item}>{station.item}</TabsTrigger>
        ))}
        {storeStations.length === 0 && (
            <div className="text-sm text-muted-foreground p-2">No kitchen stations configured for this store.</div>
        )}
      </TabsList>
      {storeStations.map(station => {
          const stationGroups = getGroupsForStation(station.item);
          return (
            <TabsContent key={station.id} value={station.item} className="flex-1 mt-6">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stationGroups.map((group) => (
                    <KitchenOrderCard
                    key={group.orderId}
                    order={group.order}
                    items={group.items}
                    onServeItem={handleServeItem}
                    onServeAll={() => handleServeAll(group.items)}
                    />
                ))}
                {stationGroups.length === 0 && (
                    <p className="text-muted-foreground col-span-full text-center">
                    No pending items for the {station.item} station.
                    </p>
                )}
                </div>
            </TabsContent>
          )
      })}
    </Tabs>
  );
}
