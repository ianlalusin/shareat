

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot, query, where, writeBatch, serverTimestamp, doc, runTransaction } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, RefillItem, OrderItem } from '@/lib/types';
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
    const [refills, setRefills] = useState<Record<string, RefillItem[]>>({});
    
    const [isRefillModalOpen, setIsRefillModalOpen] = useState(false);
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    
    const firestore = useFirestore();
    const auth = useAuth();
    const { selectedStoreId } = useStoreSelector();
    const { toast } = useToast();
    
    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId), where('status', '==', 'Occupied'));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TableType[];
                setTables(tablesData.sort((a,b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', 'in', ['Active', 'Pending Confirmation']));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Order);
                setOrders([...ordersData]);
                
                // For each active order, listen to its refills
                ordersData.forEach(order => {
                    const refillsQuery = query(collection(firestore, 'orders', order.id, 'refills'));
                    onSnapshot(refillSnapshot => {
                        const refillData = refillSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data()}) as RefillItem);
                        setRefills(prev => ({ ...prev, [order.id]: refillData }));
                    });
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

            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
                menuUnsubscribe();
            };
        } else {
            setTables([]);
            setOrders([]);
            setMenu([]);
        }
    }, [firestore, selectedStoreId]);

    const handleTableClick = (table: TableType) => {
        const order = orders.find(o => o.id === table.activeOrderId);
        if (order) {
            setSelectedTable(table);
            setSelectedOrder(order);
            if (order.status === 'Pending Confirmation') {
              setIsConfirmModalOpen(true);
            } else {
              setIsRefillModalOpen(true);
            }
        }
    }

    const handlePlaceOrder = async (
        order: Order,
        refillCart: { meatType: string; flavor: string; quantity: number; note?: string }[],
        cart: { id: string; menuName: string; price: number; quantity: number; targetStation?: 'Hot' | 'Cold'; note?: string }[]
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
                    targetStation: 'Cold',
                    timestamp: serverTimestamp(),
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
                const orderItemData: Omit<OrderItem, 'id'> = {
                    orderId: order.id,
                    storeId: order.storeId,
                    menuItemId: cartItem.id,
                    menuName: cartItem.menuName,
                    quantity: cartItem.quantity,
                    priceAtOrder: cartItem.price,
                    isRefill: false,
                    timestamp: serverTimestamp(),
                    status: 'Pending',
                    targetStation: cartItem.targetStation,
                    sourceTag: 'refill',
                    kitchenNote: cartItem.note || '',
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
        } catch (error) {
            console.error("Error placing order:", error);
            toast({
                variant: 'destructive',
                title: 'Order Failed',
                description: 'Failed to place order. Please try again.',
            });
        }
    };

    const handleConfirmGuests = async (order: Order, confirmedGuestCount: number) => {
      if (!firestore) {
        throw new Error("Firestore not available");
      }

      await runTransaction(firestore, async (transaction) => {
        const orderRef = doc(firestore, 'orders', order.id);
        
        // Create initial order item (the package itself)
        const unlimitedPackage = menu.find(m => m.menuName === order.packageName);
        if (!unlimitedPackage) {
          throw new Error("Package details could not be found.");
        }

        const orderItemRef = doc(collection(orderRef, 'orderItems'));
        const initialOrderItem: Omit<OrderItem, 'id'> = {
            orderId: order.id,
            storeId: order.storeId,
            menuItemId: unlimitedPackage.id,
            menuName: unlimitedPackage.menuName,
            quantity: confirmedGuestCount,
            priceAtOrder: unlimitedPackage.price,
            isRefill: false,
            status: 'Pending',
            targetStation: unlimitedPackage.targetStation,
            timestamp: serverTimestamp() as any,
            sourceTag: 'initial',
        };
        transaction.set(orderItemRef, initialOrderItem);

        // Update the order status and guest count
        transaction.update(orderRef, {
          status: 'Active',
          guestCount: confirmedGuestCount,
          totalAmount: unlimitedPackage.price * confirmedGuestCount, // Recalculate total
        });
      });
      toast({
        title: 'Order Confirmed!',
        description: `Table ${order.tableName} is now active.`
      });
      setIsConfirmModalOpen(false);
    };

    const pendingConfirmationOrders = useMemo(() => {
      const ordersMap = new Map(orders.filter(o => o.status === 'Pending Confirmation').map(order => [order.id, order]));
      return tables
        .filter(t => t.activeOrderId && ordersMap.has(t.activeOrderId))
        .map(table => ({
          table,
          order: ordersMap.get(table.activeOrderId!),
        }));
    }, [tables, orders]);

    const activeOrders = useMemo(() => {
       const ordersMap = new Map(orders.filter(o => o.status === 'Active').map(order => [order.id, order]));
       return tables
        .filter(t => t.activeOrderId && ordersMap.has(t.activeOrderId))
        .map(table => ({
          table,
          order: ordersMap.get(table.activeOrderId!),
        }));
    }, [tables, orders]);
    
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
      <main className="flex-1 p-4 space-y-8">
        <div>
          <h2 className="text-lg font-semibold mb-4 font-headline">Waiting for Confirmation ({pendingConfirmationOrders.length})</h2>
           {pendingConfirmationOrders.length === 0 ? (
             <p className="text-sm text-muted-foreground">No new orders waiting for confirmation.</p>
           ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {pendingConfirmationOrders.map(({ table, order }) => (
                  <Card 
                      key={table.id} 
                      className="bg-yellow-100 dark:bg-yellow-900/40 border-yellow-500 cursor-pointer hover:shadow-lg transition-shadow flex flex-col"
                      onClick={() => handleTableClick(table)}
                  >
                      <CardHeader className="p-4">
                          <CardTitle className="text-xl font-bold">{table.tableName}</CardTitle>
                          <p className="text-sm text-muted-foreground font-medium">{order?.packageName}</p>
                      </CardHeader>
                      <CardContent className="p-4 pt-0 flex-grow">
                          <p className="text-sm font-semibold">Customer: {order?.customerName || 'N/A'}</p>
                      </CardContent>
                      <CardFooter className="p-2 border-t">
                          <Button className="w-full" variant="secondary">Confirm Guests</Button>
                      </CardFooter>
                  </Card>
                ))}
             </div>
           )}
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4 font-headline">Active Tables ({activeOrders.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                          className="bg-muted/30 cursor-pointer hover:shadow-lg transition-shadow flex flex-col"
                          onClick={() => handleTableClick(table)}
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
                      </Card>
                  )
              })}
          </div>
        </div>
      </main>

      {selectedOrder && selectedTable && (
        <RefillModal
            isOpen={isRefillModalOpen}
            onClose={() => setIsRefillModalOpen(false)}
            table={selectedTable}
            order={selectedOrder}
            menu={menu}
            onPlaceOrder={handlePlaceOrder}
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
