
'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, getDocs, writeBatch, serverTimestamp, addDoc, runTransaction } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, OrderItem } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TableCard } from '@/components/cashier/table-card';
import { Flame } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { PendingItemsModal } from '@/components/cashier/pending-items-modal';

const NewOrderModal = dynamic(() => import('@/components/cashier/new-order-modal').then(mod => mod.NewOrderModal), { ssr: false });
const OrderDetailsModal = dynamic(() => import('@/components/cashier/order-details-modal').then(mod => mod.OrderDetailsModal), { ssr: false });


export default function CashierPage() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    
    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isPendingItemsModalOpen, setIsPendingItemsModalOpen] = useState(false);

    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [pendingItemsForOrder, setPendingItemsForOrder] = useState<OrderItem[]>([]);
    
    const firestore = useFirestore();
    const router = useRouter();
    const { selectedStoreId } = useStoreSelector();
    const { toast } = useToast();
    
    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TableType[];
                setTables(tablesData.sort((a,b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', '==', 'Active'));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];
                setOrders(ordersData);
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
        if (!firestore) {
            throw new Error("Firestore is not initialized.");
        }
        
        await runTransaction(firestore, async (transaction) => {
            const tableRef = doc(firestore, 'tables', table.id);
            const tableDoc = await transaction.get(tableRef);

            if (!tableDoc.exists() || tableDoc.data().status !== 'Available') {
                throw new Error(`Table ${table.tableName} is no longer available.`);
            }

            const newOrderRef = doc(collection(firestore, 'orders'));
            const order: Omit<Order, 'id'> = {
                storeId: selectedStoreId!,
                tableId: table.id,
                tableName: table.tableName,
                status: 'Active',
                guestCount: orderData.guestCount,
                customerName: orderData.customerName,
                orderTimestamp: serverTimestamp() as any,
                totalAmount: orderData.selectedPackage.price * orderData.guestCount,
                packageName: orderData.selectedPackage.menuName,
                selectedFlavors: orderData.selectedFlavors,
                kitchenNote: orderData.kitchenNote,
                priority: 'normal',
            };
            transaction.set(newOrderRef, order);
            
            // Create initial order item (the package itself)
            const orderItemRef = doc(collection(newOrderRef, 'orderItems'));
            const initialOrderItem: Omit<OrderItem, 'id'> = {
                orderId: newOrderRef.id,
                storeId: selectedStoreId!,
                menuItemId: orderData.selectedPackage.id,
                menuName: orderData.selectedPackage.menuName,
                quantity: orderData.guestCount,
                priceAtOrder: orderData.selectedPackage.price,
                isRefill: false,
                status: 'Pending',
                targetStation: orderData.selectedPackage.targetStation,
                timestamp: serverTimestamp() as any,
                sourceTag: 'initial',
            };
            transaction.set(orderItemRef, initialOrderItem);
            
            // Update table status
            transaction.update(tableRef, {
                status: 'Occupied',
                activeOrderId: newOrderRef.id,
            });
        });
        
        toast({
            title: "Order Started!",
            description: `Order for Table ${table.tableName} has been sent to the kitchen.`,
        });
    };

    const handleTogglePriority = async (order: Order) => {
      if (!firestore || !order?.id) return;
      try {
        const orderRef = doc(firestore, 'orders', order.id);
        const nextPriority = order.priority === 'rush' ? 'normal' : 'rush';
        await updateDoc(orderRef, { priority: nextPriority });
      } catch (err) {
        toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: 'Failed to update order priority.',
        });
      }
    };

    const handleBillClick = async (order: Order) => {
        if (!firestore) return;
        
        const orderItemsRef = collection(firestore, "orders", order.id, "orderItems");
        const q = query(orderItemsRef, where("status", "==", "Pending"));
        const snapshot = await getDocs(q);

        const pendingItems = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as OrderItem))
            .filter(item => item.sourceTag !== 'initial' && item.priceAtOrder > 0); // Only billable add-ons

        if (pendingItems.length > 0) {
            setPendingItemsForOrder(pendingItems);
            setSelectedOrder(order);
            setIsPendingItemsModalOpen(true);
        } else {
            router.push(`/cashier/order/${order.id}`);
        }
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
      <div className="w-1/3 border-r border-border p-4 overflow-y-auto">
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

      {/* Right Panel: Occupied Tables */}
      <div className="w-2/3 p-4 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4 font-headline">Occupied Tables ({occupiedTables.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {occupiedTables.map(({ table, order }) => (
                order ? (
                  <TableCard 
                    key={table.id}
                    table={table}
                    order={order}
                    onViewOrderClick={() => handleViewOrderClick(order)}
                    onTogglePriority={() => handleTogglePriority(order)}
                    onBillClick={() => handleBillClick(order)}
                  />
                ) : null
              ))}
          </div>
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
