
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore } from '@/firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Table as TableType, Order, MenuItem, GListItem, RefillItem, OrderItem } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Minus, Plus, ShoppingCart, Trash2, Search, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import Image from 'next/image';
import { useSuccessModal } from '@/store/use-success-modal';

interface RefillModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: TableType;
  order: Order;
  menu: MenuItem[];
}

interface RefillSelection {
    meatType: string;
    flavors: string[];
}

interface RefillCartItem {
    meatType: string;
    flavor: string;
    quantity: number;
}


interface CartItem extends MenuItem {
    quantity: number;
}

export function RefillModal({ isOpen, onClose, table, order, menu }: RefillModalProps) {
    const [flavorOptions, setFlavorOptions] = useState<GListItem[]>([]);
    const [refillSelections, setRefillSelections] = useState<Record<string, RefillSelection>>({});
    const [refillCart, setRefillCart] = useState<RefillCartItem[]>([]);
    
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    const firestore = useFirestore();
    const { openSuccessModal } = useSuccessModal();
    
    const packageDetails = useMemo(() => {
        return menu.find(m => m.menuName === order.packageName && m.category === 'Unlimited');
    }, [order, menu]);
    
    const meatTypesForPackage = useMemo(() => packageDetails?.specialTags || [], [packageDetails]);

    useEffect(() => {
        if (firestore && order.storeId) {
            const flavorsQuery = query(
                collection(firestore, 'lists'), 
                where('category', '==', 'meat flavor'), 
                where('is_active', '==', true),
                where('storeIds', 'array-contains', order.storeId)
            );
            const flavorsUnsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
                setFlavorOptions(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as GListItem));
            });

            return () => flavorsUnsubscribe();
        }
    }, [firestore, order.storeId]);

    useEffect(() => {
        if (isOpen) {
            // Initialize selections for each meat type
            const initialSelections: Record<string, RefillSelection> = {};
            meatTypesForPackage.forEach(meatType => {
                initialSelections[meatType] = { meatType, flavors: [] };
            });
            setRefillSelections(initialSelections);
        } else {
             // Reset state when modal is closed
            setRefillSelections({});
            setRefillCart([]);
            setCart([]);
            setSearchTerm('');
        }
    }, [isOpen, meatTypesForPackage]);

    const availableMenuForAddons = useMemo(() => 
        menu.filter(item => 
            item.category !== 'Unlimited' &&
            item.isAvailable &&
            (item.menuName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             item.category.toLowerCase().includes(searchTerm.toLowerCase()))
        ), [menu, searchTerm]
    );

    const handleFlavorSelect = (meatType: string, flavor: string) => {
      setRefillSelections(prev => {
        const currentFlavors = prev[meatType]?.flavors || [];
        const isSelected = currentFlavors.includes(flavor);
        let newFlavors: string[];

        if (isSelected) {
          newFlavors = currentFlavors.filter(f => f !== flavor);
        } else {
          if (currentFlavors.length < 3) {
            newFlavors = [...currentFlavors, flavor];
          } else {
            // Prevent selecting more than 3
            return prev;
          }
        }
        return {
          ...prev,
          [meatType]: { ...prev[meatType], flavors: newFlavors },
        };
      });
    };

    const handleAddToRefillCart = (meatType: string) => {
        const selection = refillSelections[meatType];
        if (!selection || selection.flavors.length === 0) {
            alert('Please select at least one flavor.');
            return;
        }

        setRefillCart(prev => {
            let updatedCart = [...prev];
            selection.flavors.forEach(flavor => {
                const existingIndex = updatedCart.findIndex(item => item.meatType === meatType && item.flavor === flavor);
                if (existingIndex > -1) {
                    updatedCart[existingIndex] = {
                        ...updatedCart[existingIndex],
                        quantity: updatedCart[existingIndex].quantity + 1
                    };
                } else {
                    updatedCart.push({ meatType, flavor, quantity: 1 });
                }
            });
            return updatedCart;
        });
    };

    const updateRefillCartQuantity = (meatType: string, flavor: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            setRefillCart(prev => prev.filter(item => !(item.meatType === meatType && item.flavor === flavor)));
        } else {
            setRefillCart(prev => prev.map(item =>
                item.meatType === meatType && item.flavor === flavor
                    ? { ...item, quantity: newQuantity }
                    : item
            ));
        }
    };


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
        if (!firestore) return;

        const batch = writeBatch(firestore);

        // Process Refills
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
                };
                batch.set(newRefillRef, refillData);
            });
        }

        // Process Add-ons
        if (cart.length > 0) {
            const orderItemsRef = collection(firestore, 'orders', order.id, 'orderItems');
            cart.forEach(cartItem => {
                const newItemRef = doc(orderItemsRef);
                const orderItemData: Omit<OrderItem, 'id' | 'orderId'> = {
                    storeId: order.storeId,
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
            onClose();
        } catch (error) {
            console.error("Error placing order:", error);
            alert("Failed to place order.");
        }
    }
    
    const cartSubtotal = useMemo(() => cart.reduce((total, item) => total + (item.price * item.quantity), 0), [cart]);

    const getSelectedFlavorText = (meatType: string) => {
      const selection = refillSelections[meatType];
      if (!selection || selection.flavors.length === 0) return 'Select up to 3 flavors';
      if (selection.flavors.length > 2) return `${selection.flavors.length} flavors selected`;
      return selection.flavors.join(', ');
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Refill / Add-on for Table {table.tableName}</DialogTitle>
                    <DialogDescription>
                        Customer: {order.customerName} | Package: {order.packageName}
                    </DialogDescription>
                </DialogHeader>
                
                <Tabs defaultValue="refill" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="refill">Refill</TabsTrigger>
                        <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="refill" className="flex-1 overflow-hidden p-4">
                        <div className="grid grid-cols-2 gap-6 h-full">
                            <div className="flex flex-col gap-4">
                                <h3 className="font-semibold">Select Meat & Flavor</h3>
                                <ScrollArea className="flex-1 rounded-md border">
                                    <div className="p-4 space-y-4">
                                    {meatTypesForPackage.map(meatType => (
                                        <div key={meatType} className="p-3 border rounded-lg">
                                            <p className="capitalize font-semibold text-lg mb-2">{meatType}</p>
                                            <div className="flex items-center gap-2">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="outline" className="w-full justify-between">
                                                            <span>{getSelectedFlavorText(meatType)}</span>
                                                            <ChevronDown className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                                        {flavorOptions.map(f => (
                                                            <DropdownMenuCheckboxItem
                                                                key={f.id}
                                                                checked={refillSelections[meatType]?.flavors.includes(f.item)}
                                                                onSelect={(e) => e.preventDefault()}
                                                                onClick={() => handleFlavorSelect(meatType, f.item)}
                                                                disabled={
                                                                    !refillSelections[meatType]?.flavors.includes(f.item) &&
                                                                    (refillSelections[meatType]?.flavors.length ?? 0) >= 3
                                                                }
                                                            >
                                                                {f.item}
                                                            </DropdownMenuCheckboxItem>
                                                        ))}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                <Button onClick={() => handleAddToRefillCart(meatType)} disabled={!refillSelections[meatType]?.flavors.length}>
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                    {meatTypesForPackage.length === 0 && <p className="text-muted-foreground text-center py-4">This package has no specified meat types for refill.</p>}
                                    </div>
                                </ScrollArea>
                            </div>
                            <div className="flex flex-col border rounded-lg">
                                <div className="p-4 border-b">
                                    <h3 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Refill Cart</h3>
                                </div>
                                <ScrollArea className="flex-1">
                                    {refillCart.length === 0 ? (
                                        <div className="text-center text-muted-foreground p-8">Refill cart is empty.</div>
                                    ) : (
                                        <div className="p-4 space-y-3">
                                            {refillCart.map(item => (
                                                <div key={`${item.meatType}-${item.flavor}`} className="flex items-center justify-between">
                                                    <div>
                                                        <p className="font-medium capitalize">{item.meatType} - {item.flavor}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, item.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                                                        <span className="w-6 text-center font-bold">{item.quantity}</span>
                                                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, item.quantity + 1)}><Plus className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, 0)}><Trash2 className="h-4 w-4" /></Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </div>
                        </div>
                    </TabsContent>
                    
                    <TabsContent value="add-ons" className="flex-1 overflow-hidden p-4">
                        <div className="grid grid-cols-2 gap-6 h-full">
                            <div className="flex flex-col gap-4 h-full">
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
                            <div className="flex flex-col border rounded-lg h-full">
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
                                        <div className="flex justify-between items-center font-semibold text-lg">
                                            <span>Subtotal</span>
                                            <span>{formatCurrency(cartSubtotal)}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
                
                <DialogFooter className="mt-4 flex-row justify-end">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button 
                        size="lg" 
                        onClick={handlePlaceOrder} 
                        disabled={refillCart.length === 0 && cart.length === 0}
                    >
                        Place Order
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

    
