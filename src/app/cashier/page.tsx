'use client';

import { useState, useEffect } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, where, doc, getDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle } from 'lucide-react';


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
    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    const [guestCount, setGuestCount] = useState(1);

    const firestore = useFirestore();
    const { selectedStoreId } = useStoreSelector();
    
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
            })

            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
            };
        } else {
            setTables([]);
            setOrders([]);
        }
    }, [firestore, selectedStoreId]);

    const availableTables = tables.filter(t => t.status === 'Available');
    const occupiedTables = tables.filter(t => t.status === 'Occupied');
    
    const handleNewOrder = () => {
        if (!selectedTable || guestCount < 1) {
            alert("Please select a table and enter a valid number of guests.");
            return;
        }
        // Logic to create a new order will be added here
        console.log(`Creating new order for table ${selectedTable.tableName} with ${guestCount} guests.`);
        setIsNewOrderModalOpen(false);
        setSelectedTable(null);
        setGuestCount(1);
    }
    
    const handleAvailableTableClick = (table: TableType) => {
        setSelectedTable(table);
        setIsNewOrderModalOpen(true);
    }

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
    <Dialog open={isNewOrderModalOpen} onOpenChange={setIsNewOrderModalOpen}>
        <div className="flex h-[calc(100vh-4rem)] bg-background">
        {/* Left Panel: Available Tables */}
        <div className="w-1/3 border-r border-border p-4 overflow-y-auto">
            <h2 className="text-lg font-semibold mb-4 font-headline">Available Tables ({availableTables.length})</h2>
            <div className="grid grid-cols-2 gap-4">
                {availableTables.map(table => (
                    <Card 
                        key={table.id} 
                        className="cursor-pointer hover:shadow-lg transition-shadow aspect-square flex items-center justify-center border-2 border-green-500"
                        onClick={() => handleAvailableTableClick(table)}
                    >
                        <CardContent className="p-1 text-center">
                            <p className="font-bold text-2xl">{table.tableName}</p>
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
                            <CardHeader className="p-4 flex-row items-center justify-between space-y-0">
                                <CardTitle className="text-xl font-bold">{table.tableName}</CardTitle>
                                <Badge className={cn("text-white", getStatusColor(table.status))}>
                                    {table.status}
                                </Badge>
                            </CardHeader>
                             <CardContent className="p-4 pt-0">
                                <div className="text-sm">
                                    <p><span className="font-semibold">Guests:</span> {order?.guestCount || 'N/A'}</p>
                                    <p><span className="font-semibold">Order ID:</span> <span className="text-xs">{table.activeOrderId || 'N/A'}</span></p>
                                    {/* Placeholder for timer */}
                                    <p><span className="font-semibold">Time:</span> 00:00:00</p>
                                </div>
                            </CardContent>
                            <CardFooter className="p-4 pt-0">
                                <Button className="w-full">View Order</Button>
                            </CardFooter>
                        </Card>
                    )
                })}
            </div>
        </div>
        </div>

        {/* New Order Modal */}
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>New Order for Table {selectedTable?.tableName}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                    <Label htmlFor="guestCount">Number of Guests</Label>
                    <Input 
                        id="guestCount" 
                        type="number"
                        value={guestCount}
                        onChange={(e) => setGuestCount(Number(e.target.value))}
                        min="1"
                        required
                        autoFocus
                    />
                </div>
            </div>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="outline">
                    Cancel
                    </Button>
                </DialogClose>
                <Button onClick={handleNewOrder}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Start Order
                </Button>
            </DialogFooter>
        </DialogContent>

    </Dialog>
  );
}
