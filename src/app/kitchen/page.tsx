

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore, useAuth } from '@/firebase';
import {
  collection,
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
  orderBy,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Order, OrderItem, RefillItem, GListItem } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { KitchenItem, KitchenOrderCard } from '@/components/kitchen/order-card';
import { cn } from '@/lib/utils';

export default function KitchenPage() {
  const [ordersById, setOrdersById] = useState<Record<string, Order>>({});
  const [orderItems, setOrderItems] = useState<KitchenItem[]>([]);
  const [refillItems, setRefillItems] = useState<KitchenItem[]>([]);
  const [storeStations, setStoreStations] = useState<GListItem[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>();
  
  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setOrdersById({});
      setStoreStations([]);
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
        setStoreStations(stationData);
        if (stationData.length > 0 && !activeTab) {
            setActiveTab(stationData[0].item);
        } else if (stationData.length === 0) {
            setActiveTab(undefined);
        }
    });

    const ordersQuery = query(
      collection(firestore, 'orders'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Active')
    );

    const unsubscribe = onSnapshot(ordersQuery, (snapshot) => {
      const map: Record<string, Order> = {};
      snapshot.docs.forEach((docSnap) => {
        map[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as Order) };
      });
      setOrdersById(map);
    });

    return () => {
        unsubStations();
        unsubscribe();
    };
  }, [firestore, selectedStoreId]);

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setOrderItems([]);
      return;
    }
    const pendingOrderItemsQuery = query(
      collectionGroup(firestore, 'orderItems'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Pending'),
      orderBy('timestamp')
    );
    const unsubOrderItems = onSnapshot(pendingOrderItemsQuery, (snapshot) => {
      const data: KitchenItem[] = snapshot.docs.map((docSnap) => {
        const itemData = docSnap.data() as OrderItem;
        const orderId = itemData.orderId;
        return {
          id: docSnap.id,
          ...itemData,
          orderId,
          order: ordersById[orderId],
          sourceCollection: 'orderItems',
          ref: docSnap.ref,
        };
      });
      setOrderItems(data);
    });
    return () => unsubOrderItems();
  }, [firestore, selectedStoreId, ordersById]);

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setRefillItems([]);
      return;
    }
    const pendingRefillsQuery = query(
      collectionGroup(firestore, 'refills'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Pending'),
      orderBy('timestamp')
    );
    const unsubRefills = onSnapshot(pendingRefillsQuery, (snapshot) => {
      const data: KitchenItem[] = snapshot.docs.map((docSnap) => {
        const itemData = docSnap.data() as RefillItem;
        const orderId = itemData.orderId;
        return {
          id: docSnap.id,
          ...itemData,
          orderId,
          order: ordersById[orderId],
          sourceCollection: 'refills',
          ref: docSnap.ref,
        };
      });
      setRefillItems(data);
    });
    return () => unsubRefills();
  }, [firestore, selectedStoreId, ordersById]);

  const kitchenItems: KitchenItem[] = useMemo(
    () => [...orderItems, ...refillItems],
    [orderItems, refillItems]
  );

  const groupedByOrder = useMemo(() => {
    const groups: {
      [orderId: string]: { orderId: string; order?: Order; items: KitchenItem[] };
    } = {};

    kitchenItems.forEach((item) => {
      const orderId = item.orderId;
      if (!groups[orderId]) {
        groups[orderId] = {
          orderId,
          order: item.order ?? ordersById[orderId],
          items: [],
        };
      }
      groups[orderId].items.push(item);
    });

    return Object.values(groups).sort((a, b) => {
      const pa = a.order?.priority === 'rush' ? 1 : 0;
      const pb = b.order?.priority === 'rush' ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return (
        (a.order?.orderTimestamp?.toMillis?.() || 0) -
        (b.order?.orderTimestamp?.toMillis?.() || 0)
      );
    });
  }, [kitchenItems, ordersById]);
  
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
      <TabsList className="h-auto flex-wrap">
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
