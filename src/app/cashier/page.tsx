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
import { PlusCircle, Minus, Plus } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';


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
    const [unlimitedPackages, setUnlimitedPackages] = useState<MenuItem[]>([]);
    const [meatFlavors, setMeatFlavors] = useState<GListItem[]>([]);
    
    const [isNewOrderModalOpen, setIsNewOrderModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<TableType | null>(null);
    
    // New Order Form State
    const [customerName, setCustomerName] = useState('');
    const [guestCount, setGuestCount] = useState(2);
    const [selectedPackage, setSelectedPackage] = useState<string>('');
    const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
    const [riceCount, setRiceCount] = useState(2);
    const [cheeseCount, setCheeseCount] = useState(2);
    const [showNotes, setShowNotes] = useState(false);
    const [notes, setNotes] = useState('');

    // TODO: Replace with actual user data
    const userName = "Jane Doe";


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
            });
            
            const menuQuery = query(
              collection(firestore, 'menu'),
              where('storeId', '==', selectedStoreId)
            );
            const menuUnsubscribe = onSnapshot(menuQuery, (snapshot) => {
              const menuData = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
              })) as MenuItem[];

              const currentHour = new Date().getHours();

              const filteredPackages = menuData.filter((item) => {
                if (item.category !== 'Unlimited' || !item.isAvailable) {
                    return false;
                }

                const availability = item.availability?.toLowerCase() || 'always';
                if (availability.includes('always') || availability.includes('all day')) {
                    return true;
                }
                
                if (availability.includes('lunch') && currentHour >= 17) {
                    return false;
                }

                if (availability.includes('dinner') && currentHour < 17) {
                    return false;
                }
                
                return true;
              });

              setUnlimitedPackages(filteredPackages);
            });


            const flavorsQuery = query(collection(firestore, 'lists'), where('category', '==', 'meat flavor'), where('is_active', '==', true), where('storeIds', 'array-contains', selectedStoreId));
            const flavorsUnsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
                const flavorsData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})) as GListItem[];
                setMeatFlavors(flavorsData);
            });


            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
                menuUnsubscribe();
                flavorsUnsubscribe();
            };
        } else {
            setTables([]);
            setOrders([]);
            setUnlimitedPackages([]);
            setMeatFlavors([]);
        }
    }, [firestore, selectedStoreId]);

    useEffect(() => {
        if (guestCount > 0) {
            setRiceCount(guestCount);
            setCheeseCount(guestCount);
        }
    }, [guestCount]);

    const availableTables = tables.filter(t => t.status === 'Available');
    const occupiedTables = tables.filter(t => t.status === 'Occupied');
    
    const resetForm = () => {
        setCustomerName('');
        setGuestCount(2);
        setSelectedPackage('');
        setSelectedFlavors([]);
        setRiceCount(2);
        setCheeseCount(2);
        setShowNotes(false);
        setNotes('');
        setSelectedTable(null);
    }
    
    const handleNewOrder = async () => {
      if (!firestore || !selectedStoreId || !selectedTable || !selectedPackage || selectedFlavors.length === 0 || !customerName) {
        alert("Please ensure all required fields are filled: Customer Name, Guests, Package, and at least one Flavor.");
        return;
      }
    
      const newOrderRef = doc(collection(firestore, 'orders'));
      const tableRef = doc(collection(firestore, 'tables'), selectedTable.id);
      const pkg = unlimitedPackages.find(p => p.id === selectedPackage);
      if(!pkg) {
          alert("Selected package not found. Please try again.");
          return;
      }

      try {
        const batch = writeBatch(firestore);
    
        // 1. Create a new order
        batch.set(newOrderRef, {
          storeId: selectedStoreId,
          tableLabel: selectedTable.tableName,
          status: 'Active',
          guestCount: guestCount,
          customerName: customerName,
          orderTimestamp: serverTimestamp(),
          totalAmount: guestCount * pkg.price,
          notes: notes,
          initialFlavors: selectedFlavors,
          packageName: pkg.menuName,
        } as Omit<Order, 'id'>);
        
        // 2. Add main package to orderItems
        const orderItemRef = doc(collection(firestore, 'orders', newOrderRef.id, 'orderItems'));
        batch.set(orderItemRef, {
            menuItemId: pkg.id,
            menuName: pkg.menuName,
            quantity: guestCount,
            priceAtOrder: pkg.price,
            isRefill: false,
            timestamp: serverTimestamp(),
        });

        // 3. Update the table
        batch.update(tableRef, {
          status: 'Occupied',
          activeOrderId: newOrderRef.id,
          resetCounter: (selectedTable.resetCounter || 0) + 1,
        });
    
        await batch.commit();
    
        setIsNewOrderModalOpen(false);
        resetForm();
      } catch (error) {
        console.error("Error creating new order: ", error);
        alert("Failed to create new order. Please try again.");
      }
    };
    
    const handleAvailableTableClick = (table: TableType) => {
        resetForm();
        setSelectedTable(table);
        setIsNewOrderModalOpen(true);
    }
    
    const handleFlavorClick = (flavor: string) => {
        setSelectedFlavors(prev => {
            if (prev.includes(flavor)) {
                return prev.filter(f => f !== flavor);
            }
            if (prev.length < 3) {
                return [...prev, flavor];
            }
            return prev;
        });
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
                            <p className="font-bold text-2xl md:text-3xl lg:text-4xl">{table.tableName}</p>
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
                                    <p><span className="font-semibold">Customer:</span> {order?.customerName || 'N/A'}</p>
                                    <p><span className="font-semibold">Guests:</span> {order?.guestCount || 'N/A'}</p>
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
        <DialogContent className="sm:max-w-xl">
            <DialogHeader>
                 <DialogTitle>
                    New Order for {selectedTable?.tableName}
                    <span className="text-sm text-muted-foreground font-normal ml-2">by {userName}</span>
                 </DialogTitle>
            </DialogHeader>
            <div className="grid gap-6 py-4">
                <div className="grid grid-cols-3 items-end gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="guestCount">No. of Guests</Label>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGuestCount(c => Math.max(1, c - 1))}><Minus className="h-4 w-4"/></Button>
                            <Input id="guestCount" type="number" value={guestCount} onChange={e => setGuestCount(Number(e.target.value))} min="1" required className="w-full text-center" />
                            <Button type="button" variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => setGuestCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="customerName">Customer Name</Label>
                        <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="package">Package</Label>
                        <Select value={selectedPackage} onValueChange={setSelectedPackage} required>
                            <SelectTrigger id="package">
                                <SelectValue placeholder="Select a package" />
                            </SelectTrigger>
                            <SelectContent>
                                {unlimitedPackages.map(pkg => (
                                    <SelectItem key={pkg.id} value={pkg.id}>{pkg.menuName}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Initial Flavors (Max 3)</Label>
                    <div className="flex flex-wrap gap-2 rounded-lg border p-4">
                         {meatFlavors.map(flavor => (
                            <Button 
                                key={flavor.id}
                                type="button"
                                variant={selectedFlavors.includes(flavor.item) ? 'default' : 'outline'}
                                onClick={() => handleFlavorClick(flavor.item)}
                                disabled={!selectedFlavors.includes(flavor.item) && selectedFlavors.length >= 3}
                            >
                                {flavor.item}
                            </Button>
                         ))}
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 items-end">
                     <div className="space-y-2">
                        <Label htmlFor="rice">Rice</Label>
                        <div className="flex items-center gap-2">
                             <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setRiceCount(c => Math.max(0, c - 1))}><Minus className="h-4 w-4"/></Button>
                            <Input id="rice" type="number" value={riceCount} onChange={e => setRiceCount(Number(e.target.value))} className="w-full text-center" />
                            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setRiceCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <Label htmlFor="cheese">Cheese</Label>
                        <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setCheeseCount(c => Math.max(0, c - 1))}><Minus className="h-4 w-4"/></Button>
                            <Input id="cheese" type="number" value={cheeseCount} onChange={e => setCheeseCount(Number(e.target.value))} className="w-full text-center" />
                             <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setCheeseCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                        </div>
                     </div>
                     <div className="flex items-center space-x-2">
                        <Switch id="show-notes" checked={showNotes} onCheckedChange={setShowNotes} />
                        <Label htmlFor="show-notes">Add Notes</Label>
                    </div>
                </div>

                {showNotes && (
                    <div className="space-y-2">
                         <Label htmlFor="notes">Notes</Label>
                         <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    </div>
                )}
            </div>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={resetForm}>
                    Clear
                </Button>
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
