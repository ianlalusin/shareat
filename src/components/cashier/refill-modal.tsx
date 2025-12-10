

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { Table as TableType, Order, MenuItem, CollectionItem, RefillItem, OrderItem } from '@/lib/types';
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { Minus, Plus, ShoppingCart, Trash2, Search, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import Image from 'next/image';
import { Badge } from '../ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Textarea } from '../ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { UpdateOrderModal } from './update-order-modal';

interface RefillCartItem {
    meatType: string;
    flavor: string;
    quantity: number;
    note?: string;
    targetStation?: string;
}

interface CartItem extends MenuItem {
    quantity: number;
    note?: string;
}

interface RefillModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: TableType;
  order: Order;
  menu: MenuItem[];
  onPlaceOrder: (order: Order, refillCart: RefillCartItem[], cart: CartItem[]) => void;
}

interface RefillSelection {
    meatType: string;
    flavors: string[];
}

export function RefillModal({ isOpen, onClose, table, order, menu, onPlaceOrder }: RefillModalProps) {
    const [flavorOptions, setFlavorOptions] = useState<CollectionItem[]>([]);
    const [refillSelections, setRefillSelections] = useState<Record<string, RefillSelection>>({});
    const [refillCart, setRefillCart] = useState<RefillCartItem[]>([]);
    
    const [cart, setCart] = useState<CartItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    
    const [noteInput, setNoteInput] = useState('');
    const [editingNoteItem, setEditingNoteItem] = useState<{ type: 'refill' | 'addon'; key: string } | null>(null);

    const [isUpdateOrderModalOpen, setIsUpdateOrderModalOpen] = useState(false);
    const [updateType, setUpdateType] = useState<'guestCount' | 'package' | null>(null);

    const firestore = useFirestore();
    const { toast } = useToast();
    
    const packageDetails = useMemo(() => {
        return menu.find(m => m.menuName === order.packageName && m.category === 'Unlimited');
    }, [order, menu]);
    
    const meatTypesForPackage = useMemo(() => packageDetails?.allowed_refills || [], [packageDetails]);

    useEffect(() => {
        if (firestore && order.storeId) {
            const flavorsQuery = query(
                collection(firestore, 'lists'), 
                where('category', '==', 'meat flavor'), 
                where('is_active', '==', true),
                where('storeIds', 'array-contains', order.storeId)
            );
            const flavorsUnsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
                setFlavorOptions(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as CollectionItem));
            });

            return () => flavorsUnsubscribe();
        }
    }, [firestore, order.storeId]);

    useEffect(() => {
        if (isOpen) {
            const initialSelections: Record<string, RefillSelection> = {};
            meatTypesForPackage.forEach(meatType => {
                initialSelections[meatType] = { meatType, flavors: [] };
            });
            setRefillSelections(initialSelections);
        } else {
            setRefillSelections({});
            setRefillCart([]);
            setCart([]);
            setSearchTerm('');
            setEditingNoteItem(null);
            setNoteInput('');
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
            toast({
                variant: 'destructive',
                title: 'No Flavor Selected',
                description: 'Please select at least one flavor to add to the cart.',
            });
            return;
        }

        const refillMenuItem = menu.find(m => m.menuName.toLowerCase().includes(meatType.toLowerCase()));

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
                    updatedCart.push({ meatType, flavor, quantity: 1, note: '', targetStation: refillMenuItem?.targetStation });
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
            return [...prev, { ...item, quantity: 1, note: '' }];
        });
    };

    const updateCartQuantity = (itemId: string, newQuantity: number) => {
        if (newQuantity <= 0) {
            setCart(prev => prev.filter(item => item.id !== itemId));
        } else {
            setCart(prev => prev.map(item => item.id === itemId ? { ...item, quantity: newQuantity } : item));
        }
    };
    
    const handlePlaceOrderClick = () => {
        onPlaceOrder(order, refillCart, cart);
    }
    
    const cartSubtotal = useMemo(() => cart.reduce((total, item) => total + (item.price * item.quantity), 0), [cart]);

    const getSelectedFlavorText = (meatType: string) => {
      const selection = refillSelections[meatType];
      if (!selection || selection.flavors.length === 0) return 'Select up to 3 flavors';
      if (selection.flavors.length > 2) return `${selection.flavors.length} flavors selected`;
      return selection.flavors.join(', ');
    }
    
    const handleSaveNote = () => {
        if (!editingNoteItem) return;
        
        if (editingNoteItem.type === 'refill') {
            const [meatType, flavor] = editingNoteItem.key.split('|');
            setRefillCart(prev => prev.map(item => 
                item.meatType === meatType && item.flavor === flavor ? {...item, note: noteInput} : item
            ));
        } else { // addon
            setCart(prev => prev.map(item => 
                item.id === editingNoteItem.key ? {...item, note: noteInput} : item
            ));
        }
        setEditingNoteItem(null);
        setNoteInput('');
    }

    const openNotePopover = (type: 'refill' | 'addon', key: string, currentNote?: string) => {
        setEditingNoteItem({ type, key });
        setNoteInput(currentNote || '');
    };
    
    const handleOpenUpdateModal = (type: 'guestCount' | 'package') => {
        setUpdateType(type);
        setIsUpdateOrderModalOpen(true);
    };

    return (
        <>
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Refill / Add-on for Table {table.tableName}</DialogTitle>
                    <DialogDescription>
                        Customer: {order.customerName} | Package: {order.packageName}
                    </DialogDescription>
                </DialogHeader>
                
                <Popover onOpenChange={(open) => !open && setEditingNoteItem(null)}>
                <Tabs defaultValue="refill" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="refill">Refill</TabsTrigger>
                        <TabsTrigger value="add-ons">Add-ons</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="refill" className="flex-1 overflow-hidden p-1">
                        <div className="grid grid-cols-3 gap-6 h-full pt-2">
                            <div className="col-span-2 flex flex-col gap-4 h-full">
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
                            <div className="col-span-1 flex flex-col border rounded-lg">
                                <div className="p-4 border-b">
                                    <h3 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Refill Cart</h3>
                                </div>
                                <ScrollArea className="flex-1">
                                    {refillCart.length === 0 ? (
                                        <div className="text-center text-muted-foreground p-8">Refill cart is empty.</div>
                                    ) : (
                                        <div className="p-4 space-y-3">
                                            {refillCart.map(item => (
                                                <div key={`${item.meatType}-${item.flavor}`}>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-medium capitalize">{item.meatType} - {item.flavor}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <PopoverTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNotePopover('refill', `${item.meatType}|${item.flavor}`, item.note)}>
                                                                    <MessageSquarePlus className="h-4 w-4" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, item.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                                                            <span className="w-6 text-center font-bold">{item.quantity}</span>
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, item.quantity + 1)}><Plus className="h-4 w-4" /></Button>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, 0)}><Trash2 className="h-4 w-4" /></Button>
                                                        </div>
                                                    </div>
                                                    {item.note && <p className="text-xs text-red-500 italic pl-1">Note: {item.note}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </div>
                        </div>
                    </TabsContent>
                    
                    <TabsContent value="add-ons" className="flex-1 overflow-hidden p-1">
                        <div className="grid grid-cols-3 gap-6 h-full pt-2">
                            <div className="col-span-2 flex flex-col gap-4 h-full">
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
                            <div className="col-span-1 flex flex-col border rounded-lg h-full">
                                <div className="p-4 border-b">
                                    <h3 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Current Add-ons</h3>
                                </div>
                                <ScrollArea className="flex-1">
                                    {cart.length === 0 ? (
                                        <div className="text-center text-muted-foreground p-8">Cart is empty.</div>
                                    ) : (
                                        <div className="p-4 space-y-3">
                                            {cart.map(item => (
                                                <div key={item.id}>
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="font-medium">{item.menuName}</p>
                                                            <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <PopoverTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNotePopover('addon', item.id, item.note)}>
                                                                    <MessageSquarePlus className="h-4 w-4" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateCartQuantity(item.id, item.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                                                            <span className="w-6 text-center font-bold">{item.quantity}</span>
                                                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateCartQuantity(item.id, item.quantity + 1)}><Plus className="h-4 w-4" /></Button>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => updateCartQuantity(item.id, 0)}><Trash2 className="h-4 w-4" /></Button>
                                                        </div>
                                                    </div>
                                                    {item.note && <p className="text-xs text-red-500 italic pl-1">Note: {item.note}</p>}
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

                <PopoverContent className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-2">
                            <h4 className="font-medium leading-none">Add Kitchen Note</h4>
                            <p className="text-sm text-muted-foreground">
                                Add a special instruction for this item.
                            </p>
                        </div>
                        <div className="grid gap-2">
                            <Textarea
                                value={noteInput}
                                onChange={(e) => setNoteInput(e.target.value)}
                                placeholder="e.g., extra crispy"
                            />
                            <Button onClick={handleSaveNote}>Save Note</Button>
                        </div>
                    </div>
                </PopoverContent>

                </Popover>

                <DialogFooter className="mt-4 flex-row justify-between">
                    <div className='flex gap-2'>
                        <Button type="button" variant="secondary" onClick={() => handleOpenUpdateModal('guestCount')}>Update Guest Count</Button>
                        <Button type="button" variant="secondary" onClick={() => handleOpenUpdateModal('package')}>Update Package</Button>
                    </div>
                    <div className='flex gap-2'>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button 
                            size="lg" 
                            onClick={handlePlaceOrderClick} 
                            disabled={refillCart.length === 0 && cart.length === 0}
                        >
                            Place Order
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        {isUpdateOrderModalOpen && updateType && (
            <UpdateOrderModal
                isOpen={isUpdateOrderModalOpen}
                onClose={() => setIsUpdateOrderModalOpen(false)}
                order={order}
                menu={menu}
                updateType={updateType}
            />
        )}
        </>
    );
}

