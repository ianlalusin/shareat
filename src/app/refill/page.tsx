
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, RefillItem } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { OrderTimer } from '@/components/cashier/order-timer';
import { RefillModal } from '@/components/cashier/refill-modal';
import { LastRefillTimer } from '@/components/cashier/last-refill-timer';


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
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    
    const firestore = useFirestore();
    const { selectedStoreId } = useStoreSelector();
    
    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId), where('status', '==', 'Occupied'));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                const tablesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TableType[];
                setTables(tablesData.sort((a,b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', '==', 'Active'));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                const ordersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[];
                setOrders(ordersData);
                
                // For each active order, listen to its refills
                ordersData.forEach(order => {
                    const refillsQuery = query(collection(firestore, 'orders', order.id, 'refills'));
                    onSnapshot(refillsQuery, (refillSnapshot) => {
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
            setIsRefillModalOpen(true);
        }
    }
    
    if (!selectedStoreId) {
        return (
            <div className="flex h-[calc(100vh-4rem)] items-center justify-center p-4">
                 <Alert className="max-w-md">
                    <AlertTitle>No Store Selected</AlertTitle>
                    <AlertDescription>Please select a store from the header to manage refills and add-ons.</AlertDescription>
                </Alert>
            </div>
        )
    }

  return (
    <>
      <main className="flex-1 p-4">
        <h2 className="text-lg font-semibold mb-4 font-headline">Occupied Tables ({tables.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tables.map(table => {
                const order = orders.find(o => o.id === table.activeOrderId);
                const orderRefills = refills[order?.id || ''] || [];
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
                                <p className="text-xs text-muted-foreground font-medium">{order?.packageName}</p>
                            </div>
                           <Badge className={cn("text-white", getStatusColor(table.status))}>
                                {table.status}
                           </Badge>
                        </CardHeader>
                        <CardContent className="p-4 pt-0 flex-grow">
                            <div className="text-sm space-y-1">
                                <p><span className="font-semibold">Guests:</span> {order?.guestCount || 'N/A'}</p>
                                <OrderTimer startTime={order?.orderTimestamp} />
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
      </main>

      {selectedOrder && selectedTable && (
        <RefillModal
            isOpen={isRefillModalOpen}
            onClose={() => setIsRefillModalOpen(false)}
            table={selectedTable}
            order={selectedOrder}
            menu={menu}
        />
      )}
    </>
  );
}
