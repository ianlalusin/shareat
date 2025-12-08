
'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, addDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, GListItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { OrderTimer } from '@/components/cashier/order-timer';
import { useRouter } from 'next/navigation';
import { OrderDetailsModal } from '@/components/cashier/order-details-modal';
import { NewOrderModal } from '@/components/cashier/new-order-modal';
import { useSuccessModal } from '@/store/use-success-modal';


const getStatusColor = (status: TableType['status']) => {
    switch (status) {
      case 'Available': return 'bg-green-500';
      case 'Occupied': return 'bg-red-500';
      case 'Reserved': return 'bg-yellow-500';
      case 'Inactive': return 'bg-gray-500';
      default: return 'bg-gray-300';
    }
};

export default function CashierPage() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    
    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    
    const firestore = useFirestore();
    const { selectedStoreId } = useStoreSelector();
    const router = useRouter();
    const { openSuccessModal } = useSuccessModal();
    
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

    const availableTables = tables.filter(t => t.status === 'Available');
    const occupiedTables = tables.filter(t => t.status === 'Occupied');
    
    const handleAvailableTableClick = (table: TableType) => {
        setSelectedTable(table);
        setIsNewOrderModalOpen(true);
    }
    
    const handleViewOrderClick = (order: Order | undefined) => {
      if (order) {
        setSelectedOrder(order);
        setIsDetailsModalOpen(true);
      }
    }

    const handleCreateOrder = async (
      table: TableType, 
      orderData: { 
        customerName: string; 
        guestCount: number; 
        selectedPackage: MenuItem; 
        selectedFlavors: string[]; 
        rice: number; 
        cheese: number;
      }
    ) => {
      if (!firestore || !selectedStoreId) return;
      
      const { customerName, guestCount, selectedPackage, selectedFlavors, rice, cheese } = orderData;
      
      const newOrderRef = doc(collection(firestore, 'orders'));
      const tableRef = doc(firestore, 'tables', table.id);

      try {
        const batch = writeBatch(firestore);

        const initialItems = [];
        if (rice > 0) initialItems.push({ name: 'Rice', quantity: rice });
        if (cheese > 0) initialItems.push({ name: 'Cheese', quantity: cheese });

        batch.set(newOrderRef, {
          storeId: selectedStoreId,
          tableLabel: table.tableName,
          status: 'Active',
          guestCount,
          customerName,
          orderTimestamp: serverTimestamp(),
          totalAmount: selectedPackage.price * guestCount,
          notes: '',
          initialItems,
          packageName: selectedPackage.menuName,
          selectedFlavors,
        });

        const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
        batch.set(orderItemRef, {
          orderId: newOrderRef.id,
          storeId: selectedStoreId,
          menuItemId: selectedPackage.id,
          menuName: selectedPackage.menuName,
          quantity: guestCount,
          priceAtOrder: selectedPackage.price,
          isRefill: false,
          timestamp: serverTimestamp(),
          status: 'Pending',
          targetStation: selectedPackage.targetStation,
          sourceTag: 'cashier',
        });

        batch.update(tableRef, {
          status: 'Occupied',
          activeOrderId: newOrderRef.id,
          resetCounter: (table.resetCounter || 0) + 1,
        });
    
        await batch.commit();
        setIsNewOrderModalOpen(false);
        openSuccessModal();
      } catch (error) {
        console.error("Error creating new order: ", error);
        alert("Failed to create new order. Please try again.");
      }
    };
    
    if (!selectedStoreId) {
        return (
            <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
                 <Alert className="max-w-md">
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
              {occupiedTables.map(table => {
                  const order = orders.find(o => o.id === table.activeOrderId);
                  return (
                      <Card key={table.id} className="bg-muted/30">
                          <CardHeader className="p-4 flex-row items-start justify-between space-y-0">
                              <div>
                                  <CardTitle className="text-xl font-bold">{table.tableName}</CardTitle>
                                  <p className="text-xs text-muted-foreground font-medium">{order?.packageName}</p>
                              </div>
                              <Badge className={cn("text-white", getStatusColor(table.status))}>
                                  {table.status}
                              </Badge>
                          </CardHeader>
                          <CardContent className="p-4 pt-0">
                              <div className="text-sm">
                                  <p><span className="font-semibold">Customer:</span> {order?.customerName || 'N/A'}</p>
                                  <p><span className="font-semibold">Guests:</span> {order?.guestCount || 'N/A'}</p>
                                  <OrderTimer startTime={order?.orderTimestamp} />
                              </div>
                          </CardContent>
                          <CardFooter className="p-4 pt-0 grid grid-cols-2 gap-2">
                              <Button variant="outline" onClick={() => router.push(`/cashier/order/${order?.id}`)}>Bill</Button>
                              <Button onClick={() => handleViewOrderClick(order)}>View Order</Button>
                          </CardFooter>
                      </Card>
                  )
              })}
          </div>
      </div>
      </div>

      {selectedTable && (
        <NewOrderModal
            isOpen={isNewOrderModalOpen}
            onClose={() => setIsNewOrderModalOpen(false)}
            table={selectedTable}
            menu={menu}
            storeId={selectedStoreId}
            onCreateOrder={handleCreateOrder}
        />
      )}
      
      {selectedOrder && (
        <OrderDetailsModal
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          order={selectedOrder}
        />
      )}
    </>
  );
}
