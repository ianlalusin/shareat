
'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
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
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { OrderItem, RefillItem, Order } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';

const KitchenOrderCard = dynamic(
  () => import('@/components/kitchen/order-card').then(m => m.KitchenOrderCard),
  { ssr: false }
);

type KitchenItem = (OrderItem | RefillItem) & {
    orderId: string;
    order?: Order;
    sourceCollection: 'orderItems' | 'refills';
};

export default function KitchenPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [refillItems, setRefillItems] = useState<RefillItem[]>([]);
  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();
  const auth = useAuth();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setOrders([]);
      setOrderItems([]);
      setRefillItems([]);
      return;
    }

    const activeOrdersQuery = query(
      collection(firestore, 'orders'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Active')
    );
    const unsubOrders = onSnapshot(activeOrdersQuery, (snapshot) => {
      const data = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as Order)
      );
      setOrders(data);
    });

    const pendingOrderItemsQuery = query(
      collectionGroup(firestore, 'orderItems'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Pending'),
      orderBy('timestamp')
    );
    const unsubOrderItems = onSnapshot(pendingOrderItemsQuery, (snapshot) => {
      const data = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data(), orderId: doc.ref.parent.parent!.id } as OrderItem)
      );
      setOrderItems(data);
    });

    const pendingRefillsQuery = query(
      collectionGroup(firestore, 'refills'),
      where('storeId', '==', selectedStoreId),
      where('status', '==', 'Pending'),
      orderBy('timestamp')
    );
    const unsubRefills = onSnapshot(pendingRefillsQuery, (snapshot) => {
      const data = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data(), orderId: doc.ref.parent.parent!.id } as RefillItem)
      );
      setRefillItems(data);
    });

    return () => {
      unsubOrders();
      unsubOrderItems();
      unsubRefills();
    };
  }, [firestore, selectedStoreId]);

  const ordersMap = useMemo(() => {
    return new Map(orders.map((o) => [o.id, o]));
  }, [orders]);

  const kitchenItems: KitchenItem[] = useMemo(() => {
    const all: KitchenItem[] = [];

    orderItems.forEach((item) => {
      all.push({
        ...item,
        order: ordersMap.get(item.orderId),
        sourceCollection: 'orderItems',
      });
    });

    refillItems.forEach((item) => {
      all.push({
        ...item,
        order: ordersMap.get(item.orderId),
        sourceCollection: 'refills',
      });
    });

    return all;
  }, [orderItems, refillItems, ordersMap]);

  const groupedByOrder = useMemo(() => {
    const groups: {
      [orderId: string]: { order: Order | undefined; items: KitchenItem[] };
    } = {};

    kitchenItems.forEach((item) => {
      if (!groups[item.orderId]) {
        groups[item.orderId] = {
          order: item.order,
          items: [],
        };
      }
      groups[item.orderId].items.push(item);
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
  }, [kitchenItems]);

  const hotGroups = useMemo(
    () =>
      groupedByOrder
        .map((group) => ({
          ...group,
          items: group.items.filter((i) => i.targetStation === 'Hot'),
        }))
        .filter((g) => g.items.length > 0),
    [groupedByOrder]
  );

  const coldGroups = useMemo(
    () =>
      groupedByOrder
        .map((group) => ({
          ...group,
          items: group.items.filter((i) => i.targetStation === 'Cold'),
        }))
        .filter((g) => g.items.length > 0),
    [groupedByOrder]
  );
  
  const handleServeItem = async (item: KitchenItem) => {
    if (!firestore) return;
    
    const user = auth?.currentUser;

    const itemRef = doc(firestore, 'orders', item.orderId, item.sourceCollection, item.id);

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

  const handleServeAll = async (groupItems: KitchenItem[]) => {
    if (!firestore || groupItems.length === 0) return;
    try {
      const batch = writeBatch(firestore);
      const user = auth?.currentUser;

      groupItems.forEach((item) => {
        const itemRef = doc(
          firestore,
          'orders',
          item.orderId,
          item.sourceCollection,
          item.id
        );
        batch.update(itemRef, {
          status: 'Served',
          servedAt: serverTimestamp(),
          servedBy: user?.displayName || user?.email || 'Kitchen',
        });
      });

      await batch.commit();
      openSuccessModal();
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
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <Alert className="max-w-md bg-background">
          <AlertTitle>No Store Selected</AlertTitle>
          <AlertDescription>
            Please select a store from the header to view kitchen orders.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <Tabs defaultValue="hot" className="flex flex-col flex-1">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="hot">Hot Station</TabsTrigger>
        <TabsTrigger value="cold">Cold Station</TabsTrigger>
      </TabsList>
      <TabsContent value="hot" className="flex-1 mt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {hotGroups.map((group) => (
            <KitchenOrderCard
              key={group.order?.id}
              order={group.order}
              items={group.items}
              onServeItem={handleServeItem}
              onServeAll={handleServeAll}
            />
          ))}
          {hotGroups.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center">
              No pending items for the hot station.
            </p>
          )}
        </div>
      </TabsContent>
      <TabsContent value="cold" className="flex-1 mt-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {coldGroups.map((group) => (
            <KitchenOrderCard
              key={group.order?.id}
              order={group.order}
              items={group.items}
              onServeItem={handleServeItem}
              onServeAll={handleServeAll}
            />
          ))}
          {coldGroups.length === 0 && (
            <p className="text-muted-foreground col-span-full text-center">
              No pending items for the cold station.
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
