

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot, query, where, writeBatch, serverTimestamp, doc, runTransaction, limit, getDocs, collectionGroup } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, RefillItem, OrderUpdateLog, CollectionItem, OrderItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { OrderTimer } from '@/components/cashier/order-timer';
import { RefillModal } from '@/components/cashier/refill-modal';
import { LastRefillTimer } from '@/components/cashier/last-refill-timer';
import { useToast } from '@/hooks/use-toast';
import { GuestConfirmationModal } from '@/components/refill/guest-confirmation-modal';
import { useAuthContext } from '@/context/auth-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddToCartModal } from '@/components/cashier/add-to-cart-modal';

const getStatusColor = (status: TableType['status']) => {
    switch (status) {
      case 'Available': return 'bg-green-500';
      case 'Occupied': return 'bg-red-500';
      case 'Reserved': return 'bg-yellow-500';
      case 'Inactive': return 'bg-gray-500';
      default: return 'bg-gray-300';
    }
};

export default function RefillPage() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [schedules, setSchedules] = useState<CollectionItem[]>([]);
    const [refills, setRefills] = useState<Record<string, RefillItem[]>>({});
    
    const [isRefillModalOpen, setIsRefillModalOpen] = useState(false);
    const [isAddToCartModalOpen, setIsAddToCartModalOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [activeTab, setActiveTab] = useState('active');

    const firestore = useFirestore();
    const { user } = useAuthContext();
    const { selectedStoreId } = useStoreSelector();
    const { toast } = useToast();
    
    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId), where('status', '==', 'Occupied'));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TableType[];
                setTables(tablesData.sort((a,b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', '==', 'Active'));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Order);
                setOrders([...ordersData]);
                
                // For each active order, listen to its refills
                ordersData.forEach(order => {
                    if (!refills[order.id]) { // Avoid re-subscribing
                        const refillsQuery = query(collectionGroup(firestore, 'refills'), where('orderId', '==', order.id));
                        onSnapshot(refillsQuery, refillSnapshot => {
                            const refillData = refillSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()}) as RefillItem);
                            setRefills(prev => ({ ...prev, [order.id]: refillData }));
                        });
                    }
                });
            });
            
            const menuQuery = query(
              collection(firestore, 'menu'),
              where('storeId', '==', selectedStoreId),
              where('isAvailable', '==', true)
            );
            const menuUnsubscribe = onSnapshot(menuQuery, (snapshot) => {
              const menuData = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
              })) as MenuItem[];
              setMenu(menuData);
            });
            
            const schedulesQuery = query(
              collection(firestore, 'lists'),
              where('category', '==', 'menu schedules'),
              where('is_active', '==', true),
              where('storeIds', 'array-contains', selectedStoreId)
            );
            const schedulesUnsubscribe = onSnapshot(schedulesQuery, (snapshot) => {
                const schedulesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CollectionItem[]);
                setSchedules(schedulesData);
            });

            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
                menuUnsubscribe();
                schedulesUnsubscribe();
            };
        } else {
            setTables([]);
            setOrders([]);
            setMenu([]);
            setSchedules([]);
            setRefills({});
        }
    }, [firestore, selectedStoreId]);
    
    const filteredMenu = useMemo(() => {
        if (schedules.length === 0) return menu;

        const now = new Date();
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];

        const activeSchedules = new Set(schedules
            .filter(schedule => 
                (schedule as any).days.includes(currentDay) &&
                (schedule as any).startTime <= currentTime &&
                (schedule as any).endTime >= currentTime
            )
            .map(schedule => schedule.item)
        );

        return menu.filter(menuItem => {
            if (menuItem.availability === 'always') {
                return true;
            }
            return activeSchedules.has(menuItem.availability);
        });
    }, [menu, schedules]);

    const handleRefillClick = (table: TableType) => {
        const order = orders.find(o => o.id === table.activeOrderId);
        if(order) {
            setSelectedOrder(order);
            setIsRefillModalOpen(true);
        }
    }
    
    const handleAddOnClick = (table: TableType) => {
        const order = orders.find(o => o.id === table.activeOrderId);
        if(order) {
            setSelectedOrder(order);
            setIsAddToCartModalOpen(true);
        }
    }

    const handleConfirmClick = (table: TableType) => {
        const order = orders.find(o => o.id === table.activeOrderId);
        if (order) {
            setSelectedTable(table);
            setSelectedOrder(order);
            setIsConfirmModalOpen(true);
        }
    }

    const handlePlaceOrder = async (
        order: Order,
        refillCart: { meatType: string; flavor: string; quantity: number; note?: string, targetStation?: string; }[],
        cart: (MenuItem & { quantity: number; note?: string; })[]
    ) => {
        if (!firestore) return;

        const batch = writeBatch(firestore);

        if (refillCart.length > 0) {
            const refillsRef = collection(firestore, 'orders', order.id, 'refills');
            refillCart.forEach(refill => {
                const newRefillRef = doc(refillsRef);
                const refillData: Omit<RefillItem, 'id'> = {
                    orderId: order.id,
                    storeId: order.storeId,
                    menuItemId: refill.meatType.toLowerCase(),
                    menuName: `${refill.meatType} - ${refill.flavor}`,
                    quantity: refill.quantity,
                    targetStation: refill.targetStation as 'Hot' | 'Cold',
                    timestamp: serverTimestamp() as any,
                    status: 'Pending',
                    kitchenNote: refill.note || '',
                };
                batch.set(newRefillRef, refillData);
            });
        }

        if (cart.length > 0) {
            const orderItemsRef = collection(firestore, 'orders', order.id, 'orderItems');
            cart.forEach(cartItem => {
                const newItemRef = doc(orderItemsRef);
                const rate = cartItem.taxRate ?? 0;
                const orderItemData: Omit<OrderItem, 'id'> = {
                    orderId: order.id,
                    storeId: order.storeId,
                    menuItemId: cartItem.id,
                    menuName: cartItem.menuName,
                    quantity: cartItem.quantity,
                    priceAtOrder: cartItem.price,
                    isRefill: false,
                    timestamp: serverTimestamp() as any,
                    status: 'Pending',
                    targetStation: cartItem.targetStation,
                    sourceTag: 'refill',
                    kitchenNote: cartItem.note || '',
                    taxRate: rate,
                    taxProfileCode: cartItem.taxProfileCode ?? null,
                    isFree: false,
                };
                batch.set(newItemRef, orderItemData);
            });
        }

        try {
            await batch.commit();
            toast({
                title: 'Order Sent!',
                description: 'Refills and add-ons have been sent to the kitchen.',
            });
            setIsRefillModalOpen(false);
            setIsAddToCartModalOpen(false);
        } catch (error) {
            console.error("Error placing order:", error);
            toast({
                variant: 'destructive',
                title: 'Order Failed',
                description: 'Failed to place order. Please try again.',
            });
        }
    };

    const handleConfirmGuests = async (order: Order, serverGuestCount: number) => {
      if (!firestore || !user) {
        throw new Error("Firestore not available");
      }

      await runTransaction(firestore, async (transaction) => {
        const orderRef = doc(firestore, 'orders', order.id);
        const orderDoc = await transaction.get(orderRef);
        if(!orderDoc.exists()) throw new Error("Order not found.");
        
        const currentOrderData = orderDoc.data() as Order;
        const cashierGuestCount = currentOrderData.guestCount;
        const finalGuestCount = Math.max(cashierGuestCount, serverGuestCount);

        const updates: Partial<Order> = { isServerConfirmed: true };
        const auditChanges: OrderUpdateLog['changes'] = [];

        if (finalGuestCount !== cashierGuestCount) {
          const unlimitedPackage = menu.find(m => m.menuName === order.packageName);
          if (!unlimitedPackage) throw new Error("Package details could not be found.");

          const newTotalAmount = unlimitedPackage.price * finalGuestCount;
          updates.guestCount = finalGuestCount;
          updates.totalAmount = newTotalAmount;

          auditChanges.push({ field: 'guestCount', oldValue: cashierGuestCount, newValue: finalGuestCount });
          auditChanges.push({ field: 'totalAmount', oldValue: currentOrderData.totalAmount, newValue: newTotalAmount });

          // Update the initial package order item's quantity
          const itemsQuery = query(collection(firestore, 'orders', order.id, 'orderItems'), where('sourceTag', '==', 'initial'), limit(1));
          const itemsSnap = await getDocs(itemsQuery); // Use getDocs inside transaction
          if (!itemsSnap.empty) {
            const initialItemDoc = itemsSnap.docs[0];
            transaction.update(initialItemDoc.ref, { quantity: finalGuestCount });
          }
        }
        
        transaction.update(orderRef, updates);

        if (auditChanges.length > 0) {
            const auditLogRef = doc(collection(orderRef, 'orderAudits'));
            const auditLog: Omit<OrderUpdateLog, 'id'> = {
                orderId: order.id,
                storeId: order.storeId,
                timestamp: serverTimestamp() as any,
                updatedByUid: user.uid,
                updatedByName: user.displayName || user.email!,
                reason: `Server confirmed guest count. Cashier: ${cashierGuestCount}, Server: ${serverGuestCount}.`,
                changes: auditChanges,
            };
            transaction.set(auditLogRef, auditLog);
        }
      });
      
      toast({
        title: 'Guests Confirmed!',
        description: `Table ${order.tableName} is now ready for refills.`
      });
      setIsConfirmModalOpen(false);
    };

    const pendingConfirmationOrders = useMemo(() => {
      const ordersMap = new Map(orders.filter(o => !o.isServerConfirmed).map(order => [order.id, order]));
      return tables
        .filter(t => t.activeOrderId && ordersMap.has(t.activeOrderId))
        .map(table => ({
          table,
          order: ordersMap.get(table.activeOrderId!),
        }));
    }, [tables, orders]);

    const activeOrders = useMemo(() => {
       const ordersMap = new Map(orders.filter(o => o.isServerConfirmed).map(order => [order.id, order]));
       return tables
        .filter(t => t.activeOrderId && ordersMap.has(t.activeOrderId))
        .map(table => ({
          table,
          order: ordersMap.get(table.activeOrderId!),
        }));
    }, [tables, orders]);
    
    // Effect to auto-switch tabs
    const prevPendingCountRef = useRef(pendingConfirmationOrders.length);
    useEffect(() => {
        const currentPendingCount = pendingConfirmationOrders.length;
        if (currentPendingCount > prevPendingCountRef.current) {
            if (!isRefillModalOpen && !isConfirmModalOpen && !isAddToCartModalOpen) {
                setActiveTab('waiting');
            }
        }
        prevPendingCountRef.current = currentPendingCount;
    }, [pendingConfirmationOrders.length, isRefillModalOpen, isConfirmModalOpen, isAddToCartModalOpen]);

    if (!selectedStoreId) {
        return (
            <div className="flex h-[calc(100vh-4rem)] items-center justify-center p-4">
                 <Alert variant="info" size="sm" className="max-w-md">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store from the header to manage refills and add-ons.</AlertDescription>
                </Alert>
            </div>
        )
    }

  return (
    <>
      <main className="flex-1 p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="waiting">Waiting for Confirmation ({pendingConfirmationOrders.length})</TabsTrigger>
                <TabsTrigger value="active">Active Tables ({activeOrders.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="waiting" className="flex-1 mt-6">
                {pendingConfirmationOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center pt-8">No new orders waiting for confirmation.</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {pendingConfirmationOrders.map(({ table, order }) => {
                    if (!order) return null;
                    return (
                        <Card 
                            key={table.id} 
                            className="bg-yellow-100 dark:bg-yellow-900/40 border-yellow-500 cursor-pointer hover:shadow-lg transition-shadow flex flex-col"
                            onClick={() => handleConfirmClick(table)}
                        >
                            <CardHeader className="p-4">
                                <CardTitle className="text-xl font-bold">{table.tableName}</CardTitle>
                                <p className="text-sm text-muted-foreground font-medium">{order.packageName}</p>
                            </CardHeader>
                            <CardContent className="p-4 pt-0 flex-grow">
                                <p className="text-sm font-semibold">Customer: {order.customerName || 'N/A'}</p>
                            </CardContent>
                            <CardFooter className="p-2 border-t">
                                <Button className="w-full" variant="secondary">Confirm Guests</Button>
                            </CardFooter>
                        </Card>
                    )
                    })}
                </div>
            )}
            </TabsContent>
            <TabsContent value="active" className="flex-1 mt-6">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {activeOrders.map(({table, order}) => {
                    if (!order) return null;
                    const orderRefills = refills[order.id] || [];
                    const lastRefill = orderRefills.length > 0 
                        ? orderRefills.reduce((latest, current) => {
                            if (!latest?.timestamp) return current;
                            if (!current?.timestamp) return latest;
                            return (latest.timestamp.toMillis() > current.timestamp.toMillis()) ? latest : current
                        }) : null;
                    
                    return (
                        <Card 
                            key={table.id} 
                            className="bg-muted/30 hover:shadow-lg transition-shadow flex flex-col"
                        >
                            <CardHeader className="p-4 flex-row items-start justify-between space-y-0">
                                <div>
                                    <CardTitle className="text-xl font-bold">{table.tableName}</CardTitle>
                                    <p className="text-xs text-muted-foreground font-medium">{order.packageName}</p>
                                </div>
                                <Badge className={cn("text-white", getStatusColor(table.status))}>
                                    {table.status}
                                </Badge>
                            </CardHeader>
                            <CardContent className="p-4 pt-0 flex-grow">
                                <div className="text-sm space-y-1">
                                    <p><span className="font-semibold">Guests:</span> {order.guestCount}</p>
                                    <OrderTimer startTime={order.orderTimestamp} />
                                    {lastRefill ? (
                                        <div className="pt-2">
                                            <p className="font-semibold text-xs text-muted-foreground">Last Refill:</p>
                                            <p>{lastRefill.quantity}x {lastRefill.menuName}</p>
                                            <LastRefillTimer refillTime={lastRefill.timestamp} />
                                        </div>
                                    ) : (
                                        <p className="pt-2 text-sm text-muted-foreground">No refills yet.</p>
                                    )}
                                </div>
                            </CardContent>
                             <CardFooter className="p-2 border-t grid grid-cols-2 gap-2">
                                <Button variant="outline" onClick={() => handleRefillClick(table)}>Refill</Button>
                                <Button variant="outline" onClick={() => handleAddOnClick(table)}>Add-ons</Button>
                            </CardFooter>
                        </Card>
                    )
                })}
                </div>
            </TabsContent>
        </Tabs>
      </main>

      {isRefillModalOpen && selectedOrder && (
        <RefillModal
            isOpen={isRefillModalOpen}
            onClose={() => setIsRefillModalOpen(false)}
            table={tables.find(t => t.id === selectedOrder.tableId)!}
            order={selectedOrder}
            menu={filteredMenu}
            onPlaceOrder={handlePlaceOrder}
        />
      )}
      
      {isAddToCartModalOpen && selectedOrder && (
        <AddToCartModal
            isOpen={isAddToCartModalOpen}
            onClose={() => setIsAddToCartModalOpen(false)}
            order={selectedOrder}
            menu={filteredMenu}
        />
      )}

      {selectedOrder && selectedTable && (
        <GuestConfirmationModal
          isOpen={isConfirmModalOpen}
          onClose={() => setIsConfirmModalOpen(false)}
          order={selectedOrder}
          onConfirm={handleConfirmGuests}
        />
      )}
    </>
  );
}
