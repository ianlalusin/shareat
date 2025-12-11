
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
  collectionGroup,
  orderBy,
  limit,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Order, OrderItem, RefillItem, CollectionItem } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { KitchenItem, KitchenOrderCard } from '@/components/kitchen/order-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';

export default function KitchenPage() {
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [kitchenItemsByOrder, setKitchenItemsByOrder] = useState<Record<string, KitchenItem[]>>({});
  const [storeStations, setStoreStations] = useState<CollectionItem[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>();
  const [servedOrderItems, setServedOrderItems] = useState<KitchenItem[]>([]);
  const [servedRefillItems, setServedRefillItems] = useState<KitchenItem[]>([]);

  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore || !selectedStoreId) {
      setStoreStations([]);
      setActiveOrders([]);
      setKitchenItemsByOrder({});
      setActiveTab(undefined);
      setServedOrderItems([]);
      setServedRefillItems([]);
      return;
    }

    const stationsQuery = query(
      collection(firestore, 'lists'),
      where('category', '==', 'store stations'),
      where('is_active', '==', true),
      where('storeIds', 'array-contains', selectedStoreId)
    );
    const unsubStations = onSnapshot(stationsQuery, (snapshot) => {
        const stationData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CollectionItem);
        stationData.sort((a,b) => a.item.localeCompare(b.item));
        setStoreStations(stationData);
        if (stationData.length > 0 && !activeTab) {
            setActiveTab(stationData[0].item);
        } else if (stationData.length === 0) {
            setActiveTab(undefined);
        }
    });

    // Fetch recently served order items
    const servedItemsQuery = query(
      collectionGroup(firestore, 'orderItems'),
      where('storeId', '==', selectedStoreId),
      orderBy('servedTimestamp', 'desc'),
      limit(25)
    );
    const unsubServedItems = onSnapshot(servedItemsQuery, (snapshot) => {
      const items = snapshot.docs
        .map(d => ({...d.data(), id: d.id, ref: d.ref, sourceCollection: 'orderItems'}) as KitchenItem)
        .filter(item => item.status === 'Served');
      setServedOrderItems(items);
    });

    // Fetch recently served refills
    const servedRefillsQuery = query(
      collectionGroup(firestore, 'refills'),
      where('storeId', '==', selectedStoreId),
      orderBy('servedTimestamp', 'desc'),
      limit(25)
    );
    const unsubServedRefills = onSnapshot(servedRefillsQuery, (snapshot) => {
      const items = snapshot.docs
        .map(d => ({...d.data(), id: d.id, ref: d.ref, sourceCollection: 'refills'}) as KitchenItem)
        .filter(item => item.status === 'Served');
      setServedRefillItems(items);
    });

    return () => {
      unsubStations();
      unsubServedItems();
      unsubServedRefills();
    }
  }, [firestore, selectedStoreId, activeTab]);

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

  const servedWithOrderDetails = useMemo(() => {
    const combinedServed = [...servedOrderItems, ...servedRefillItems];
    const sortedServed = combinedServed.sort((a, b) => 
      (b.servedTimestamp?.toMillis() || 0) - (a.servedTimestamp?.toMillis() || 0)
    ).slice(0, 20);

    const orderMap = new Map(activeOrders.map(o => [o.id, o]));
    return sortedServed.map(item => ({
        ...item,
        order: orderMap.get(item.orderId)
    }));
  }, [servedOrderItems, servedRefillItems, activeOrders]);

  
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
    <div className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6 h-full">
        <div className="flex-1">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
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
                        <ScrollArea className="h-full">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 pr-4">
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
                        </ScrollArea>
                    </TabsContent>
                )
            })}
            </Tabs>
        </div>
        <aside className="hidden lg:block">
            <Card className="sticky top-[80px]">
                <CardHeader>
                    <CardTitle className="text-lg">Recently Served</CardTitle>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    <ScrollArea className="h-[calc(100vh-14rem)]">
                        <div className="p-4 space-y-4">
                            {servedWithOrderDetails.map(item => (
                                <div key={item.id}>
                                    <div className="flex justify-between items-start">
                                        <p className="font-medium text-sm leading-tight max-w-[180px]">
                                            {item.quantity}x {item.menuName}
                                        </p>
                                        <p className="text-sm font-semibold">{item.order?.tableName}</p>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {item.servedTimestamp ? formatDistanceToNow(item.servedTimestamp.toDate(), { addSuffix: true }) : 'Just now'}
                                    </p>
                                </div>
                            ))}
                            {servedWithOrderDetails.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">No items served recently.</p>}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </aside>
    </div>
  );
}
