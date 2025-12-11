
'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Plus, Minus, ShoppingCart, Trash2, MessageSquarePlus } from 'lucide-react';
import { Table as TableType, MenuItem, Order, OrderItem } from '@/lib/types';
import { ScrollArea } from '../ui/scroll-area';
import { formatCurrency } from '@/lib/utils';
import { Separator } from '../ui/separator';
import Image from 'next/image';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Textarea } from '../ui/textarea';

interface CartItem extends MenuItem {
    quantity: number;
    note?: string;
}

interface AddonsModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: TableType;
  order: Order;
  menu: MenuItem[];
  onPlaceOrder: (order: Order, cart: CartItem[]) => void;
}

export function AddonsModal({ isOpen, onClose, table, order, menu, onPlaceOrder }: AddonsModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteInput, setNoteInput] = useState('');
  const [editingNoteItem, setEditingNoteItem] = useState<{ key: string } | null>(null);

  const availableMenuForAddons = useMemo(() => 
    menu.filter(item => {
        const price = item.price ?? 0;
        return item.category !== 'Package' &&
            item.isAvailable &&
            price > 0 &&
            (item.menuName.toLowerCase().includes(searchTerm.toLowerCase()) ||
             item.category.toLowerCase().includes(searchTerm.toLowerCase()))
    }), [menu, searchTerm]
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
      return [...cart, { ...item, quantity: 1, note: '' }];
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

  const handleClearCart = () => {
    setCart([]);
  }

  const handlePlaceOrderClick = () => {
    onPlaceOrder(order, cart);
  };
  
  const handleSaveNote = () => {
    if (!editingNoteItem) return;
    setCart(prev => prev.map(item => 
        item.id === editingNoteItem.key ? {...item, note: noteInput} : item
    ));
    setEditingNoteItem(null);
    setNoteInput('');
  }

  const openNotePopover = (key: string, currentNote?: string) => {
    setEditingNoteItem({ key });
    setNoteInput(currentNote || '');
  };

  useEffect(() => {
      if(!isOpen) {
        setCart([]);
        setSearchTerm('');
        setEditingNoteItem(null);
        setNoteInput('');
      }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-full md:max-w-7xl h-full md:h-[90vh] flex flex-col p-2 sm:p-4">
        <DialogHeader className='p-4 pb-0 sm:p-0'>
          <DialogTitle>Add Items to Order: {table.tableName}</DialogTitle>
          <DialogDescription>
            Customer: {order.customerName} | Package: {order.packageName}
          </DialogDescription>
        </DialogHeader>

        <Popover onOpenChange={(open) => !open && setEditingNoteItem(null)}>
        <div className="grid md:grid-cols-[3fr_2fr] gap-6 flex-1 overflow-hidden p-2 sm:p-0">
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
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pr-4">
                        {availableMenuForAddons.map(item => (
                            <div key={item.id} className="flex flex-col items-center justify-between p-2 rounded-lg border text-center aspect-square">
                                <div className="h-16 w-16 flex-shrink-0 bg-muted rounded-md overflow-hidden relative mb-2">
                                    {item.imageUrl && <Image src={item.imageUrl} alt={item.menuName} layout='fill' objectFit='cover'/>}
                                </div>
                                <div className='flex-grow flex flex-col justify-center'>
                                    <p className="font-semibold text-xs leading-tight">{item.menuName}</p>
                                    <p className="text-xs text-muted-foreground">{formatCurrency(item.price)}</p>
                                </div>
                                <Button size="sm" className="mt-2 w-full h-8 text-xs" onClick={() => handleAddToCart(item)}>
                                    <Plus className="h-4 w-4 mr-1" /> Add
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
                            <div key={item.id}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">{item.menuName}</p>
                                        <p className="text-sm text-muted-foreground">{formatCurrency(item.price)}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <PopoverTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNotePopover(item.id, item.note)}>
                                              <MessageSquarePlus className="h-4 w-4" />
                                          </Button>
                                        </PopoverTrigger>
                                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                                            <Minus className="h-4 w-4" />
                                        </Button>
                                        <span className="w-6 text-center font-bold">{item.quantity}</span>
                                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                {item.note && <p className="text-xs text-red-500 italic pl-1">Note: {item.note}</p>}
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
            <Button variant="destructive" onClick={handleClearCart} disabled={cart.length === 0}>
                <Trash2 className="mr-2 h-4 w-4" /> Clear
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={handlePlaceOrderClick} disabled={cart.length === 0}>
                Add to Order ({cart.reduce((acc, item) => acc + item.quantity, 0)})
              </Button>
            </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
