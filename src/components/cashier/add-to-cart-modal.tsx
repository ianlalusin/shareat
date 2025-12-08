
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Minus, ShoppingCart, Trash2 } from 'lucide-react';
import { MenuItem, Order, OrderItem } from '@/lib/types';
import { ScrollArea } from '../ui/scroll-area';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '../ui/separator';
import Image from 'next/image';
import { useFirestore } from '@/firebase';
import { writeBatch, collection, doc, serverTimestamp } from 'firebase/firestore';
import { useSuccessModal } from '@/store/use-success-modal';

interface AddToCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  menu: MenuItem[];
}

interface CartItem extends MenuItem {
    quantity: number;
}

export function AddToCartModal({ isOpen, onClose, order, menu }: AddToCartModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const firestore = useFirestore();
  const { openSuccessModal } = useSuccessModal();

  const availableMenu = useMemo(() => 
    menu.filter(item => item.category !== 'Unlimited' && item.isAvailable),
    [menu]
  );
  
  const filteredMenu = useMemo(() =>
    availableMenu.filter(item =>
      item.menuName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [availableMenu, searchTerm]
  );
  
  const cartSubtotal = useMemo(() => 
    cart.reduce((total, item) => total + (item.price * item.quantity), 0),
    [cart]
  );

  const handleAddToCart = (item: MenuItem) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(cartItem => cartItem.id === item.id);
      if (existingItem) {
        return prevCart.map(cartItem =>
          cartItem.id === item.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        );
      }
      return [...prevCart, { ...item, quantity: 1 }];
    });
  };
  
  const updateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCart(prevCart => prevCart.filter(item => item.id !== itemId));
    } else {
      setCart(prevCart =>
        prevCart.map(item =>
          item.id === itemId ? { ...item, quantity: newQuantity } : item
        )
      );
    }
  };

  const removeItem = (itemId: string) => {
    setCart(prevCart => prevCart.filter(item => item.id !== itemId));
  };

  const handleClearCart = () => {
    setCart([]);
  }

  const handleAddToOrder = async () => {
    if (!firestore || cart.length === 0) return;

    try {
        const batch = writeBatch(firestore);
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

        await batch.commit();
        openSuccessModal();
        onClose();

    } catch (error) {
        console.error("Error adding items to order:", error);
        alert("Failed to add items. Please try again.");
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Items to Order</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-6 flex-1 overflow-hidden">
            {/* Left: Menu */}
            <div className="flex flex-col gap-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search menu..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <ScrollArea className="flex-1">
                    <div className="space-y-2 pr-4">
                        {filteredMenu.map(item => (
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

            {/* Right: Cart */}
            <div className="flex flex-col border-l pl-6">
                <h3 className="text-lg font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Current Cart</h3>
                <Separator className="my-3" />
                <ScrollArea className="flex-1">
                   {cart.length === 0 ? (
                    <div className="text-center text-muted-foreground py-16">
                        <p>Your cart is empty.</p>
                        <p className="text-sm">Add items from the menu.</p>
                    </div>
                   ) : (
                    <div className="space-y-3 pr-4">
                        {cart.map(item => (
                            <div key={item.id} className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{item.menuName}</p>
                                    <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                                        <Minus className="h-4 w-4" />
                                    </Button>
                                    <span className="w-6 text-center font-bold">{item.quantity}</span>
                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                                        <Plus className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(item.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                   )}
                </ScrollArea>
                {cart.length > 0 && (
                    <>
                        <Separator className="my-3" />
                        <div className="flex justify-between items-center font-semibold text-lg">
                            <span>Subtotal</span>
                            <span>{formatCurrency(cartSubtotal)}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
        <DialogFooter className="mt-4 flex-row justify-between">
            <Button variant="destructive" onClick={handleClearCart} disabled={cart.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" /> Clear
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handleAddToOrder} disabled={cart.length === 0}>
                Add to Order ({cart.reduce((acc, item) => acc + item.quantity, 0)})
              </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
