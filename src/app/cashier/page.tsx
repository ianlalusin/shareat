

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useFirestore, useAuthContext } from '@/firebase';
import { collection, onSnapshot, query, where, getDocs, writeBatch, serverTimestamp, doc, runTransaction } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, PendingOrderUpdate, OrderItem } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TableCard } from '@/components/cashier/table-card';
import { ChevronLeft, ChevronRight, Flame } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PendingItemsModal } from '@/components/cashier/pending-items-modal';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PendingUpdateCard } from '@/components/cashier/pending-update-card';
import { Badge } from '@/components/ui/badge';

const NewOrderModal = dynamic(() => import('@/components/cashier/new-order-modal').then(mod => mod.NewOrderModal), { ssr: false });
const OrderDetailsModal = dynamic(() => import('@/components/cashier/order-details-modal').then(mod => mod.OrderDetailsModal), { ssr: false });


export default function CashierPage() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [pendingUpdates, setPendingUpdates] = useState<(PendingOrderUpdate & {order: Order})[]>([]);

    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isPendingItemsModalOpen, setIsPendingItemsModalOpen] = useState(false);
    const [isAvailableCollapsed, setIsAvailableCollapsed] = useState(false);

    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [pendingItemsForOrder, setPendingItemsForOrder] = useState<any[]>([]);
    
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
            };
        } else {
            setTables([]);
            setOrders([]);
            setMenu([]);
            setPendingUpdates([]);
        }
    }, [firestore, selectedStoreId]);

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
    
    const handleAvailableTableClick = (table: TableType) => {
        setSelectedTable(table);
        setIsNewOrderModalOpen(true);
    }
    
    const handleViewOrderClick = (order: Order) => {
        setSelectedOrder(order);
        setIsDetailsModalOpen(true);
    }

    const handleCreateOrder = async (
        table: TableType,
        orderData: {
            customerName: string;
            guestCount: number;
            selectedPackage: MenuItem;
            selectedFlavors: string[];
            kitchenNote?: string;
        }
    ) => {
        if (!firestore || !user) {
          throw new Error('Firestore not available');
        }
    
        await runTransaction(firestore, async (transaction) => {
          const tableRef = doc(firestore, 'tables', table.id);
          const tableDoc = await transaction.get(tableRef);
    
          if (!tableDoc.exists() || tableDoc.data().status !== 'Available') {
            throw new Error(`Table ${table.tableName} is no longer available.`);
          }
    
          const newOrderRef = doc(collection(firestore, 'orders'));
          
          const newOrder: Omit<Order, 'id'> = {
            storeId: table.storeId,
            tableId: table.id,
            tableName: table.tableName,
            status: 'Active',
            guestCount: orderData.guestCount,
            customerName: orderData.customerName,
            orderTimestamp: serverTimestamp() as any,
            totalAmount: orderData.selectedPackage.price * orderData.guestCount,
            packageName: orderData.selectedPackage.menuName,
            selectedFlavors: orderData.selectedFlavors,
            kitchenNote: orderData.kitchenNote || '',
            priority: 'normal',
            isServerConfirmed: false,
          };
          transaction.set(newOrderRef, newOrder);
          
          const initialItem: Omit<OrderItem, 'id'> = {
            orderId: newOrderRef.id,
            storeId: table.storeId,
            menuItemId: orderData.selectedPackage.id,
            menuName: orderData.selectedPackage.menuName,
            quantity: orderData.guestCount,
            priceAtOrder: orderData.selectedPackage.price,
            isRefill: true,
            timestamp: serverTimestamp() as any,
            status: 'Pending',
            targetStation: 'Hot',
            sourceTag: 'initial',
          };
          const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
          transaction.set(orderItemRef, initialItem);
    
          transaction.update(tableRef, { status: 'Occupied', activeOrderId: newOrderRef.id, resetCounter: table.resetCounter + 1 });
        });
    };

    const handleTogglePriority = async (order: Order) => {
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
    };

    const handleBillClick = (order: Order) => {
        router.push(`/cashier/order/${order.id}`);
    };
    
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
                          onClick={() => handleAvailableTableClick(table)}
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
                                onViewOrderClick={() => handleViewOrderClick(order)}
                                onTogglePriority={() => handleTogglePriority(order)}
                                onBillClick={() => handleBillClick(order)}
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

      {isNewOrderModalOpen && selectedTable && (
        <NewOrderModal
            isOpen={isNewOrderModalOpen}
            onClose={() => setIsNewOrderModalOpen(false)}
            table={selectedTable}
            menu={menu}
            storeId={selectedStoreId!}
            onCreateOrder={handleCreateOrder}
        />
      )}
      
      {isDetailsModalOpen && selectedOrder && (
        <OrderDetailsModal
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          order={selectedOrder}
        />
      )}

      {isPendingItemsModalOpen && selectedOrder && (
        <PendingItemsModal
            isOpen={isPendingItemsModalOpen}
            onClose={() => setIsPendingItemsModalOpen(false)}
            order={selectedOrder}
            pendingItems={pendingItemsForOrder}
        />
      )}
    </>
  );
}
