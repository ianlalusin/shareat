

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore } from '@/firebase';
import { useAuthContext } from '@/context/auth-context';
import { collection, onSnapshot, query, where, getDocs, writeBatch, serverTimestamp, doc, runTransaction } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, PendingOrderUpdate, OrderItem, CollectionItem, RefillItem } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TableCard } from '@/components/cashier/table-card';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingUpdateCard } from '@/components/cashier/pending-update-card';
import { Badge } from '@/components/ui/badge';
import { NewOrderModal } from '@/components/cashier/new-order-modal';
import { RefillModal } from '@/components/cashier/refill-modal';
import { AddonsModal } from '@/components/cashier/addons-modal';
import { OrderDetailsModal } from '@/components/cashier/order-details-modal';
import { RoleGate } from '@/components/auth/role-gate';


function CashierPageContent() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [schedules, setSchedules] = useState<CollectionItem[]>([]);
    const [pendingUpdates, setPendingUpdates] = useState<(PendingOrderUpdate & {order: Order})[]>([]);

    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [isRefillModalOpen, setIsRefillModalOpen] = useState(false);
    const [isAddonsModalOpen, setIsAddonsModalOpen] = useState(false);
    const [isOrderDetailsModalOpen, setIsOrderDetailsModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isAvailableCollapsed, setIsAvailableCollapsed] = useState(false);
    
    const firestore = useFirestore();
    const router = useRouter();
    const { selectedStoreId } = useStoreSelector();
    const { user } = useAuthContext();
    const { toast } = useToast();
    
    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TableType[];
                setTables(tablesData.sort((a,b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', 'in', ['Active']));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Order);
                setOrders([...ordersData]);
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
              where('is_active', '==', true)
            );
            const schedulesUnsubscribe = onSnapshot(schedulesQuery, (snapshot) => {
                const schedulesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as CollectionItem[]);
                setSchedules(schedulesData);
            });
            
            const updatesQuery = query(collection(firestore, `orders`), where('storeId', '==', selectedStoreId), where('status', '==', 'Active'));
            const updatesUnsubscribe = onSnapshot(updatesQuery, async (ordersSnapshot) => {
                const currentOrders = ordersSnapshot.docs.map(d => ({ id: d.id, ...d.data() }) as Order);
                
                const updatePromises = currentOrders.map(async (order) => {
                    const pendingUpdatesRef = collection(firestore, `orders/${order.id}/pendingUpdates`);
                    const pendingUpdatesSnap = await getDocs(pendingUpdatesRef);
                    return pendingUpdatesSnap.docs.map(doc => ({
                        id: doc.id,
                        ...(doc.data() as PendingOrderUpdate),
                        order,
                    }));
                });

                const updatesByOrder = await Promise.all(updatePromises);
                const allUpdates = updatesByOrder.flat();
                setPendingUpdates(allUpdates);
            });


            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
                menuUnsubscribe();
                updatesUnsubscribe();
                schedulesUnsubscribe();
            };
        } else {
            setTables([]);
            setOrders([]);
            setMenu([]);
            setSchedules([]);
            setPendingUpdates([]);
        }
    }, [firestore, selectedStoreId]);

    const handleCreateOrder = async (table: TableType, orderData: { customerName: string; guestCount: number; selectedPackage: MenuItem; selectedFlavors: string[], kitchenNote?: string }) => {
        if (!firestore) throw new Error("Firestore not available");
        if (!selectedStoreId) throw new Error("No store selected");
    
        const orderRef = doc(collection(firestore, 'orders'));
    
        await runTransaction(firestore, async (transaction) => {
          const tableRef = doc(firestore, 'tables', table.id);
          const tableDoc = await transaction.get(tableRef);
          if (!tableDoc.exists() || tableDoc.data()?.status !== 'Available') {
            throw new Error(`Table ${table.tableName} is no longer available.`);
          }
    
          const { selectedPackage, guestCount } = orderData;
    
          const newOrder: Omit<Order, 'id'> = {
            storeId: selectedStoreId,
            tableId: table.id,
            tableName: table.tableName,
            status: 'Active',
            guestCount: guestCount,
            customerName: orderData.customerName,
            orderTimestamp: serverTimestamp() as any,
            totalAmount: selectedPackage.price * guestCount,
            packageName: selectedPackage.menuName,
            selectedFlavors: orderData.selectedFlavors,
            kitchenNote: orderData.kitchenNote,
            isServerConfirmed: false, // Server needs to confirm guest count
          };
          transaction.set(orderRef, newOrder);
    
          const unitPrice = selectedPackage.price ?? 0;
          const isFree = unitPrice === 0;
          const rate = selectedPackage.taxRate ?? 0;
          const taxProfile = menu.find(
            (m) => m.taxProfileCode === selectedPackage.taxProfileCode
          );

          const initialOrderItem: Omit<OrderItem, 'id'> = {
            orderId: orderRef.id,
            storeId: selectedStoreId,
            menuItemId: selectedPackage.id,
            menuName: selectedPackage.menuName,
            quantity: guestCount,
            priceAtOrder: unitPrice,
            targetStation: selectedPackage.targetStation,
            timestamp: serverTimestamp() as any,
            status: 'Pending',
            isRefill: false,
            sourceTag: 'initial',
            taxRate: rate,
            taxProfileCode: selectedPackage.taxProfileCode ?? null,
            isTaxInclusive: (taxProfile as any)?.isInclusive !== false,
            isFree: isFree,
          };
          const orderItemRef = doc(collection(firestore, 'orders', orderRef.id, 'orderItems'));
          transaction.set(orderItemRef, initialOrderItem);
    
          transaction.update(tableRef, { status: 'Occupied', activeOrderId: orderRef.id });
        });
    };

    const handleNewOrderClick = (table: TableType) => {
        setSelectedTable(table);
        setIsNewOrderModalOpen(true);
    };

    const handlePlaceRefillOrder = async (order: Order, refillCart: { meatType: string; flavor: string; quantity: number; note?: string, targetStation?: string; }[]) => {
      if (!firestore || refillCart.length === 0) return;
      const batch = writeBatch(firestore);
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
      try {
        await batch.commit();
        toast({ title: 'Refill Sent!', description: 'Refill order has been sent to the kitchen.' });
        setIsRefillModalOpen(false);
      } catch (error) {
        console.error("Error placing refill:", error);
        toast({ variant: 'destructive', title: 'Order Failed', description: 'Failed to place refill order.' });
      }
    };
    
    const handlePlaceAddonsOrder = async (order: Order, cart: (MenuItem & { quantity: number; note?: string; })[]) => {
      if (!firestore || cart.length === 0) return;
      const batch = writeBatch(firestore);
      const orderItemsRef = collection(firestore, 'orders', order.id, 'orderItems');
      cart.forEach(cartItem => {
        const newItemRef = doc(orderItemsRef);
        const unitPrice = cartItem.price ?? 0;
        const isFree = unitPrice === 0;
        const rate = cartItem.taxRate ?? 0;
        const taxProfile = menu.find(
          (m) => m.taxProfileCode === cartItem.taxProfileCode
        );

        const orderItemData: Omit<OrderItem, 'id'> = {
          orderId: order.id,
          storeId: order.storeId,
          menuItemId: cartItem.id,
          menuName: cartItem.menuName,
          quantity: cartItem.quantity,
          priceAtOrder: unitPrice,
          isRefill: false,
          timestamp: serverTimestamp() as any,
          status: 'Pending',
          targetStation: cartItem.targetStation,
          sourceTag: 'cashier', 
          kitchenNote: cartItem.note || '',
          taxRate: rate,
          taxProfileCode: cartItem.taxProfileCode ?? null,
          isTaxInclusive: (taxProfile as any)?.isInclusive !== false,
          isFree,
        };
        batch.set(newItemRef, orderItemData);
      });
      try {
        await batch.commit();
        toast({ title: 'Add-ons Sent!', description: 'Add-on items have been sent to the kitchen.' });
        setIsAddonsModalOpen(false);
      } catch (error) {
        console.error("Error placing add-ons:", error);
        toast({ variant: 'destructive', title: 'Order Failed', description: 'Failed to place add-on order.' });
      }
    };


    const availableTables = useMemo(() => tables.filter(t => t.status === 'Available'), [tables]);
    
    const occupiedTables = useMemo(() => {
      const ordersMap = new Map(orders.map(order => [order.id, order]));
      return tables
        .filter(t => t.status === 'Occupied' && t.activeOrderId)
        .map(table => ({
          table,
          order: ordersMap.get(table.activeOrderId!),
        }));
    }, [tables, orders]);
    
    const handleRefillClick = useCallback((order: Order) => {
        setSelectedOrder(order);
        setIsRefillModalOpen(true);
    }, []);
    
    const handleAddOnClick = useCallback((order: Order) => {
        setSelectedOrder(order);
        setIsAddonsModalOpen(true);
    }, []);

    const handleViewOrderClick = useCallback((order: Order) => {
      setSelectedOrder(order);
      setIsOrderDetailsModalOpen(true);
    }, []);

    const handleTogglePriority = useCallback(async (order: Order) => {
        if (!firestore) return;
        const orderRef = doc(firestore, 'orders', order.id);
        const newPriority = order.priority === 'rush' ? 'normal' : 'rush';
        try {
            const batch = writeBatch(firestore);
            batch.update(orderRef, { priority: newPriority });

            const itemsQuery = query(collection(firestore, 'orders', order.id, 'orderItems'), where('status', '==', 'Pending'));
            const itemsSnapshot = await getDocs(itemsQuery);
            itemsSnapshot.forEach(doc => {
                batch.update(doc.ref, { priority: newPriority });
            });

            const refillsQuery = query(collection(firestore, 'orders', order.id, 'refills'), where('status', '==', 'Pending'));
            const refillsSnapshot = await getDocs(refillsQuery);
            refillsSnapshot.forEach(doc => {
                batch.update(doc.ref, { priority: newPriority });
            });

            await batch.commit();

            toast({
                title: 'Priority Updated',
                description: `Order for table ${order.tableName} marked as ${newPriority}.`,
            });
        } catch (error) {
             toast({
                variant: 'destructive',
                title: 'Update Failed',
                description: 'Could not update order priority.',
            });
        }
    }, [firestore, toast]);

    const handleBillClick = useCallback((order: Order) => {
        router.push(`/cashier/order/${order.id}`);
    }, [router]);
    
    if (!selectedStoreId) {
        return (
            <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
                 <Alert variant="info" className="max-w-md">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store from the header to begin.</AlertDescription>
                </Alert>
            </div>
        )
    }

  return (
    <>
      <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Left Panel: Available Tables */}
      <div className={`relative transition-all duration-300 ease-in-out ${isAvailableCollapsed ? 'w-0' : 'w-1/3'}`}>
          <div className={`h-full border-r border-border p-4 overflow-y-auto ${isAvailableCollapsed ? 'hidden' : ''}`}>
              <h2 className="text-lg font-semibold mb-4 font-headline">Available Tables ({availableTables.length})</h2>
              <div className="grid grid-cols-2 gap-4">
                  {availableTables.map(table => (
                      <Card 
                          key={table.id} 
                          className="cursor-pointer hover:shadow-lg transition-shadow h-14 flex items-center justify-center border-2 border-green-500"
                          onClick={() => handleNewOrderClick(table)}
                      >
                          <CardContent className="p-1 text-center">
                              <p className="font-bold text-lg md:text-xl lg:text-2xl">{table.tableName}</p>
                          </CardContent>
                      </Card>
                  ))}
              </div>
          </div>
           <Button 
                variant="destructive"
                className={`absolute top-1/2 -right-4 -translate-y-1/2 h-12 w-10 p-0 rounded-full z-10`}
                onClick={() => setIsAvailableCollapsed(!isAvailableCollapsed)}
            >
                {isAvailableCollapsed ? <ChevronRight className="h-5 w-5"/> : <ChevronLeft className="h-5 w-5"/>}
            </Button>
      </div>
      

      {/* Right Panel: Occupied Tables */}
      <div className={`p-4 overflow-y-auto transition-all duration-300 ease-in-out ${isAvailableCollapsed ? 'w-full' : 'w-2/3'}`}>
            <Tabs defaultValue="occupied" className="flex flex-col flex-1">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="occupied">Occupied Tables ({occupiedTables.length})</TabsTrigger>
                    <TabsTrigger value="pending" className="relative">
                        Pending Changes 
                        {pendingUpdates.length > 0 && <Badge className="absolute -top-2 -right-2 h-5 w-5 justify-center p-0">{pendingUpdates.length}</Badge>}
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="occupied" className="flex-1 mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {occupiedTables.map(({ table, order }) => {
                            if (!order) return null; // Add this guard
                            return (
                            <TableCard 
                                key={table.id}
                                table={table}
                                order={order}
                                onRefillClick={() => handleRefillClick(order)}
                                onAddOnClick={() => handleAddOnClick(order)}
                                onViewOrderClick={() => handleViewOrderClick(order)}
                                onTogglePriority={handleTogglePriority}
                                onBillClick={handleBillClick}
                            />
                            )
                        })}
                         {occupiedTables.length === 0 && (
                            <p className="text-muted-foreground col-span-full text-center pt-8">No occupied tables.</p>
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="pending" className="flex-1 mt-6 space-y-3">
                     {pendingUpdates.map(update => (
                        <PendingUpdateCard key={update.id} update={update} />
                     ))}
                     {pendingUpdates.length === 0 && (
                        <p className="text-muted-foreground text-center pt-8">No pending order changes.</p>
                     )}
                </TabsContent>
            </Tabs>
      </div>
      </div>
      
       {isNewOrderModalOpen && selectedTable && selectedStoreId && (
        <NewOrderModal
            isOpen={isNewOrderModalOpen}
            onClose={() => setIsNewOrderModalOpen(false)}
            table={selectedTable}
            menu={menu}
            schedules={schedules}
            storeId={selectedStoreId}
            onCreateOrder={handleCreateOrder}
        />
       )}
       {isRefillModalOpen && selectedOrder && selectedTable && (
            <RefillModal
                isOpen={isRefillModalOpen}
                onClose={() => setIsRefillModalOpen(false)}
                table={selectedTable}
                order={selectedOrder}
                menu={menu}
                onPlaceOrder={handlePlaceRefillOrder}
            />
       )}
        {isAddonsModalOpen && selectedOrder && selectedTable && (
            <AddonsModal
                isOpen={isAddonsModalOpen}
                onClose={() => setIsAddonsModalOpen(false)}
                table={selectedTable}
                order={selectedOrder}
                menu={menu}
                onPlaceOrder={handlePlaceAddonsOrder}
            />
       )}
       {isOrderDetailsModalOpen && selectedOrder && (
        <OrderDetailsModal
          isOpen={isOrderDetailsModalOpen}
          onClose={() => setIsOrderDetailsModalOpen(false)}
          order={selectedOrder}
          menu={menu}
        />
       )}
    </>
  );
}

export default function CashierPage() {
    return (
        <RoleGate allow={['admin', 'manager', 'cashier']}>
            <CashierPageContent />
        </RoleGate>
    )
}
