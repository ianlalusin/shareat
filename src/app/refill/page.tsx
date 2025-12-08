
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, where, doc, getDoc, writeBatch, serverTimestamp, addDoc } from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table as TableType, Order, MenuItem, GListItem, RefillItem, OrderItem } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Minus, Plus, ShoppingCart, Trash2, Search } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { formatCurrency } from '@/lib/utils';
import Image from 'next/image';
import { useSuccessModal } from '@/store/use-success-modal';

interface RefillRequest {
    meatType: string;
    flavor: string;
    quantity: number;
}

interface CartItem extends MenuItem {
    quantity: number;
}

export default function RefillPage() {
    const [tables, setTables] = useState<TableType[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [menu, setMenu] = useState<MenuItem[]>([]);
    const [flavorOptions, setFlavorOptions] = useState<GListItem[]>([]);
    const [selectedTableId, setSelectedTableId] = useState<string>('');
    const [refillRequests, setRefillRequests] = useState<RefillRequest[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    const firestore = useFirestore();
    const { selectedStoreId } = useStoreSelector();
    const { openSuccessModal } = useSuccessModal();

    useEffect(() => {
        if (firestore && selectedStoreId) {
            const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId), where('status', '==', 'Occupied'));
            const tablesUnsubscribe = onSnapshot(tablesQuery, (snapshot) => {
                setTables(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as TableType)));
            });

            const ordersQuery = query(collection(firestore, 'orders'), where('storeId', '==', selectedStoreId), where('status', '==', 'Active'));
            const ordersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
                setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
            });
            
            const menuQuery = query(collection(firestore, 'menu'), where('storeId', '==', selectedStoreId), where('isAvailable', '==', true));
            const menuUnsubscribe = onSnapshot(menuQuery, (snapshot) => {
                setMenu(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MenuItem)));
            });

            const flavorsQuery = query(collection(firestore, 'lists'), where('category', '==', 'meat flavors'), where('is_active', '==', true));
            const flavorsUnsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
                setFlavorOptions(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as GListItem));
            });

            return () => {
                tablesUnsubscribe();
                ordersUnsubscribe();
                menuUnsubscribe();
                flavorsUnsubscribe();
            };
        }
    }, [firestore, selectedStoreId]);

    const selectedOrder = useMemo(() => {
        if (!selectedTableId) return null;
        const table = tables.find(t => t.id === selectedTableId);
        return orders.find(o => o.id === table?.activeOrderId);
    }, [selectedTableId, tables, orders]);

    const packageDetails = useMemo(() => {
        if (!selectedOrder) return null;
        return menu.find(m => m.menuName === selectedOrder.packageName);
    }, [selectedOrder, menu]);
    
    const meatTypesForPackage = useMemo(() => packageDetails?.specialTags || [], [packageDetails]);

    const availableMenuForAddons = useMemo(() => 
        menu.filter(item => 
            item.category !== 'Unlimited' &&
            item.isAvailable &&
            (item.menuName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             item.category.toLowerCase().includes(searchTerm.toLowerCase()))
        ), [menu, searchTerm]
    );

    const handleTableChange = (tableId: string) => {
        setSelectedTableId(tableId);
        setRefillRequests([]);
        setCart([]);
    }

    const handleRefillChange = (meatType: string, flavor: string, quantity: number) => {
        setRefillRequests(prev => {
            const existing = prev.find(r => r.meatType === meatType);
            if (existing) {
                return prev.map(r => r.meatType === meatType ? { ...r, flavor, quantity } : r);
            }
            return [...prev, { meatType, flavor, quantity }];
        });
    }

    const handleAddToCart = (item: MenuItem) => {
        setCart(prev => {
            const existing = prev.find(cartItem => cartItem.id === item.id);
            if (existing) {
                return prev.map(ci => ci.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci);
            }
            return [...prev, { ...item, quantity: 1 }];
        });
    };

    const updateCartQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            setCart(prev => prev.filter(item => item.id !== itemId));
        } else {
            setCart(prev => prev.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item));
        }
    };
    
    const handlePlaceOrder = async () => {
        if (!firestore || !selectedOrder || !selectedStoreId) return;

        const batch = writeBatch(firestore);

        // Process Refills
        const validRefills = refillRequests.filter(r => r.quantity > 0 && r.flavor);
        if (validRefills.length > 0) {
            const refillsRef = collection(firestore, 'orders', selectedOrder.id, 'refills');
            validRefills.forEach(refill => {
                const newRefillRef = doc(refillsRef);
                const refillData: Omit<RefillItem, 'id'> = {
                    orderId: selectedOrder.id,
                    storeId: selectedStoreId,
                    menuItemId: refill.meatType.toLowerCase(), // e.g. 'pork'
                    menuName: `${refill.meatType} - ${refill.flavor}`,
                    quantity: refill.quantity,
                    targetStation: 'Hot', // Assuming all meat refills are hot
                    timestamp: serverTimestamp(),
                    status: 'Pending',
                };
                batch.set(newRefillRef, refillData);
            });
        }

        // Process Add-ons
        if (cart.length > 0) {
            const orderItemsRef = collection(firestore, 'orders', selectedOrder.id, 'orderItems');
            cart.forEach(cartItem => {
                const newItemRef = doc(orderItemsRef);
                const orderItemData: Omit<OrderItem, 'id' | 'orderId'> = {
                    storeId: selectedStoreId,
                    menuItemId: cartItem.id,
                    menuName: cartItem.menuName,
                    quantity: cartItem.quantity,
                    priceAtOrder: cartItem.price,
                    isRefill: false,
                    timestamp: serverTimestamp(),
                    status: 'Pending',
                    targetStation: cartItem.targetStation
                };
                batch.set(newItemRef, orderItemData);
            });
        }

        try {
            await batch.commit();
            openSuccessModal();
            setRefillRequests([]);
            setCart([]);
            // Optional: unselect table after ordering
            // setSelectedTableId(''); 
        } catch (error) {
            console.error("Error placing order:", error);
            alert("Failed to place order.");
        }
    }
    
    const cartSubtotal = useMemo(() => cart.reduce((total, item) => total + (item.price * item.quantity), 0), [cart]);


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
        <div className="flex flex-col h-[calc(100vh-4rem)]">
            <header className="bg-primary text-primary-foreground p-4">
                 <div className="max-w-4xl mx-auto">
                    <Label htmlFor="table-select">Select a Table</Label>
                    <Select onValueChange={handleTableChange} value={selectedTableId}>
                        <SelectTrigger id="table-select" className="mt-1 bg-primary-foreground text-primary">
                            <SelectValue placeholder="Choose an occupied table..." />
                        </SelectTrigger>
                        <SelectContent>
                            {tables.map(table => (
                                <SelectItem key={table.id} value={table.id}>{table.tableName} - {orders.find(o => o.id === table.activeOrderId)?.customerName || 'N/A'}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>
            </header>

            {selectedTableId && selectedOrder && packageDetails ? (
                <Tabs defaultValue="refill" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2 sticky top-0 bg-background z-10 rounded-none">
                        <TabsTrigger value="refill">Refill</TabsTrigger>
                        <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="refill" className="flex-1 overflow-y-auto p-4">
                        <Card className="max-w-4xl mx-auto">
                            <CardHeader>
                                <CardTitle>Request Refills</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {meatTypesForPackage.map(meatType => (
                                    <div key={meatType} className="grid grid-cols-3 gap-4 items-end">
                                        <Label className="capitalize font-semibold text-lg">{meatType}</Label>
                                        <Select onValueChange={(flavor) => handleRefillChange(meatType, flavor, refillRequests.find(r=>r.meatType===meatType)?.quantity || 1)}>
                                            <SelectTrigger><SelectValue placeholder="Select Flavor" /></SelectTrigger>
                                            <SelectContent>
                                                {flavorOptions.map(f => <SelectItem key={f.id} value={f.item}>{f.item}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <div className="flex items-center gap-1">
                                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => handleRefillChange(meatType, refillRequests.find(r=>r.meatType===meatType)?.flavor || '', Math.max(0, (refillRequests.find(r=>r.meatType===meatType)?.quantity || 0) - 1))}><Minus className="h-4 w-4"/></Button>
                                            <Input type="number" value={refillRequests.find(r=>r.meatType===meatType)?.quantity || 0} readOnly className="w-full text-center h-10" />
                                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => handleRefillChange(meatType, refillRequests.find(r=>r.meatType===meatType)?.flavor || '', (refillRequests.find(r=>r.meatType===meatType)?.quantity || 0) + 1)}><Plus className="h-4 w-4"/></Button>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </TabsContent>
                    
                    <TabsContent value="add-ons" className="flex-1 grid grid-cols-2 gap-6 overflow-hidden p-4">
                         <div className="flex flex-col gap-4">
                            <div className="relative">
                                <Input placeholder="Search add-ons..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            </div>
                            <ScrollArea className="flex-1 rounded-md border">
                                <div className="p-4 space-y-2">
                                    {availableMenuForAddons.map(item => (
                                        <div key={item.id} className="flex items-center justify-between p-2 rounded-lg border">
                                            <div className="flex items-center gap-3">
                                                <div className="h-12 w-12 flex-shrink-0 bg-muted rounded-md overflow-hidden relative">
                                                    {item.imageUrl && <Image src={item.imageUrl} alt={item.menuName} layout='fill' objectFit='cover'/>}
                                                </div>
                                                <div>
                                                    <p className="font-semibold">{item.menuName}</p>
                                                    <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                                                </div>
                                            </div>
                                            <Button size="sm" onClick={() => handleAddToCart(item)}>
                                                <Plus className="h-4 w-4 mr-2" /> Add
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </ScrollArea>
                        </div>
                        <div className="flex flex-col border rounded-lg">
                            <div className="p-4 border-b">
                                <h3 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Current Add-ons</h3>
                            </div>
                            <ScrollArea className="flex-1">
                                {cart.length === 0 ? (
                                    <div className="text-center text-muted-foreground p-8">Cart is empty.</div>
                                ) : (
                                    <div className="p-4 space-y-3">
                                        {cart.map(item => (
                                            <div key={item.id} className="flex items-center justify-between">
                                                <div>
                                                    <p className="font-medium">{item.menuName}</p>
                                                    <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateCartQuantity(item.id, item.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                                                    <span className="w-6 text-center font-bold">{item.quantity}</span>
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateCartQuantity(item.id, item.quantity + 1)}><Plus className="h-4 w-4" /></Button>
                                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => updateCartQuantity(item.id, 0)}><Trash2 className="h-4 w-4" /></Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </ScrollArea>
                            {cart.length > 0 && (
                                <div className="p-4 border-t">
                                    <Separator className="my-3" />
                                    <div className="flex justify-between items-center font-semibold text-lg">
                                        <span>Subtotal</span>
                                        <span>{formatCurrency(cartSubtotal)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    <footer className="p-4 border-t bg-background sticky bottom-0 z-10">
                        <div className="max-w-4xl mx-auto flex justify-end">
                            <Button size="lg" onClick={handlePlaceOrder} disabled={refillRequests.every(r => r.quantity === 0) && cart.length === 0}>
                                Place Order
                            </Button>
                        </div>
                    </footer>
                </Tabs>
            ) : (
                <div className="flex-1 flex items-center justify-center">
                    <Alert className="max-w-md">
                        <AlertTitle>Select a Table</AlertTitle>
                        <AlertDescription>Choose a table to start adding refills or new items to an order.</AlertDescription>
                    </Alert>
                </div>
            )}
        </div>
    );
}
