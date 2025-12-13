
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Table as TableType, Order, MenuItem, RefillItem } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '../ui/scroll-area';
import { Minus, Plus, ShoppingCart, Trash2, ChevronDown, MessageSquarePlus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Textarea } from '../ui/textarea';
import { useToast } from '@/hooks/use-toast';

interface RefillCartItem {
    meatType: string;
    flavor: string;
    quantity: number;
    note?: string;
    targetStation?: string;
}

interface RefillModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: TableType;
  order: Order;
  menu: MenuItem[];
  onPlaceOrder: (order: Order, refillCart: RefillCartItem[]) => void;
}

interface RefillSelection {
    meatType: string;
    flavors: string[];
}

export function RefillModal({ isOpen, onClose, table, order, menu, onPlaceOrder }: RefillModalProps) {
    const [refillSelections, setRefillSelections] = useState<Record<string, RefillSelection>>({});
    const [refillCart, setRefillCart] = useState<RefillCartItem[]>([]);
    
    const [noteInput, setNoteInput] = useState('');
    const [editingNoteItem, setEditingNoteItem] = useState<{ key: string } | null>(null);

    const { toast } = useToast();
    
    const packageDetails = useMemo(() => {
        return menu.find(m => m.menuName === order.packageName && m.category === 'Package' && m.isAvailable === true) || null;
    }, [order.packageName, menu]);
    
    const meatTypesForPackage = useMemo(() => {
        if (!packageDetails || !packageDetails.allowed_refills) return [];
        const allowedNames = packageDetails.allowed_refills || [];
        return menu.filter(m => m.category === 'Refill' && m.isAvailable === true && allowedNames.includes(m.menuName));
    }, [packageDetails, menu]);

    useEffect(() => {
        if (isOpen) {
            const initialSelections: Record<string, RefillSelection> = {};
            meatTypesForPackage.forEach(meatTypeItem => {
                initialSelections[meatTypeItem.menuName] = { meatType: meatTypeItem.menuName, flavors: [] };
            });
            setRefillSelections(initialSelections);
        } else {
            setRefillSelections({});
            setRefillCart([]);
            setEditingNoteItem(null);
            setNoteInput('');
        }
    }, [isOpen, meatTypesForPackage]);

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
            toast({
                variant: 'destructive',
                title: 'Max 3 Flavors',
                description: 'You can select up to 3 flavors per meat type.',
            });
            return prev;
          }
        }
        return {
          ...prev,
          [meatType]: { ...prev[meatType], flavors: newFlavors },
        };
      });
    };

    const handleAddToRefillCart = (meatTypeItem: MenuItem) => {
        const selection = refillSelections[meatTypeItem.menuName];
        const hasFlavors = meatTypeItem.flavors && meatTypeItem.flavors.length > 0;

        if (hasFlavors && (!selection || selection.flavors.length === 0)) {
            toast({
                variant: 'destructive',
                title: 'Flavor Required',
                description: 'Please select at least one flavor to add to the cart.',
            });
            return;
        }

        setRefillCart(prev => {
            let updatedCart = [...prev];
            if (hasFlavors) {
                selection.flavors.forEach(flavor => {
                    const existingIndex = updatedCart.findIndex(item => item.meatType === meatTypeItem.menuName && item.flavor === flavor);
                    if (existingIndex > -1) {
                        updatedCart[existingIndex] = {
                            ...updatedCart[existingIndex],
                            quantity: updatedCart[existingIndex].quantity + 1
                        };
                    } else {
                        updatedCart.push({ meatType: meatTypeItem.menuName, flavor, quantity: 1, targetStation: meatTypeItem?.targetStation });
                    }
                });
            } else { // No flavors
                 const existingIndex = updatedCart.findIndex(item => item.meatType === meatTypeItem.menuName && item.flavor === 'Original');
                 if (existingIndex > -1) {
                    updatedCart[existingIndex] = {
                        ...updatedCart[existingIndex],
                        quantity: updatedCart[existingIndex].quantity + 1
                    };
                } else {
                    updatedCart.push({ meatType: meatTypeItem.menuName, flavor: 'Original', quantity: 1, targetStation: meatTypeItem?.targetStation });
                }
            }
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
    
    const handlePlaceOrderClick = () => {
        onPlaceOrder(order, refillCart);
    }
    
    const getSelectedFlavorText = (meatType: string) => {
      const selection = refillSelections[meatType];
      if (!selection || selection.flavors.length === 0) return 'Select up to 3 flavors';
      const count = selection.flavors.length;
      return `${count} flavor${count > 1 ? 's' : ''} selected`;
    }
    
    const handleSaveNote = () => {
        if (!editingNoteItem) return;
        
        const [meatType, flavor] = editingNoteItem.key.split('|');
        setRefillCart(prev => prev.map(item => 
            item.meatType === meatType && item.flavor === flavor ? {...item, note: noteInput} : item
        ));
        
        setEditingNoteItem(null);
        setNoteInput('');
    }

    const openNotePopover = (key: string, currentNote?: string) => {
        setEditingNoteItem({ key });
        setNoteInput(currentNote || '');
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-full md:max-w-4xl h-full md:h-auto md:max-h-[90vh] flex flex-col p-2 sm:p-6">
                <DialogHeader className='p-4 pb-0 sm:p-0'>
                    <DialogTitle>Refill Order: {table.tableName}</DialogTitle>
                    <DialogDescription>
                        Customer: {order.customerName} | Package: {order.packageName}
                    </DialogDescription>
                </DialogHeader>
                
                <Popover onOpenChange={(open) => !open && setEditingNoteItem(null)}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 overflow-hidden pt-2">
                        <div className="flex flex-col gap-4 h-full">
                            <h3 className="font-semibold px-4 md:px-0">Select Meat & Flavor</h3>
                            <ScrollArea className="flex-1 rounded-md border">
                                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {meatTypesForPackage.map(meatTypeItem => {
                                  const hasFlavors = meatTypeItem.flavors && meatTypeItem.flavors.length > 0;
                                  return (
                                    <div key={meatTypeItem.id} className="p-3 border rounded-lg">
                                        <p className="capitalize font-semibold text-lg mb-2">{meatTypeItem.menuName}</p>
                                        <div className="flex items-center gap-2">
                                            {hasFlavors ? (
                                              <DropdownMenu>
                                                  <DropdownMenuTrigger asChild>
                                                      <Button variant="outline" className="w-full justify-between">
                                                          <span>{getSelectedFlavorText(meatTypeItem.menuName)}</span>
                                                          <ChevronDown className="h-4 w-4" />
                                                      </Button>
                                                  </DropdownMenuTrigger>
                                                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                                      {(meatTypeItem.flavors || []).map(f => (
                                                          <DropdownMenuCheckboxItem
                                                              key={f}
                                                              checked={refillSelections[meatTypeItem.menuName]?.flavors.includes(f)}
                                                              onSelect={(e) => e.preventDefault()}
                                                              onClick={() => handleFlavorSelect(meatTypeItem.menuName, f)}
                                                              disabled={
                                                                  !refillSelections[meatTypeItem.menuName]?.flavors.includes(f) &&
                                                                  (refillSelections[meatTypeItem.menuName]?.flavors.length ?? 0) >= 3
                                                              }
                                                          >
                                                              {f}
                                                          </DropdownMenuCheckboxItem>
                                                      ))}
                                                  </DropdownMenuContent>
                                              </DropdownMenu>
                                            ) : <div className="w-full text-sm text-muted-foreground italic">No flavors</div>}
                                            <Button onClick={() => handleAddToRefillCart(meatTypeItem)} disabled={hasFlavors && !refillSelections[meatTypeItem.menuName]?.flavors.length}>
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                  )
                                })}
                                {meatTypesForPackage.length === 0 && <p className="text-muted-foreground text-center py-4 col-span-full">This package has no specified meat types for refill.</p>}
                                </div>
                            </ScrollArea>
                        </div>
                        <div className="flex flex-col border rounded-lg">
                            <div className="p-4 border-b">
                                <h3 className="text-base font-semibold flex items-center gap-2"><ShoppingCart className="h-5 w-5"/> Refill Cart</h3>
                            </div>
                            <ScrollArea className="flex-1">
                                {refillCart.length === 0 ? (
                                    <div className="text-center text-muted-foreground p-8 text-sm">Refill cart is empty.</div>
                                ) : (
                                    <div className="p-4 space-y-3">
                                        {refillCart.map(item => (
                                            <div key={`${item.meatType}-${item.flavor}`}>
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="font-medium capitalize text-xs">{item.meatType}{item.flavor !== 'Original' ? ` - ${item.flavor}`: ''}</p>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <PopoverTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openNotePopover(`${item.meatType}|${item.flavor}`, item.note)}>
                                                                <MessageSquarePlus className="h-4 w-4" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateRefillCartQuantity(item.meatType, item.flavor, item.quantity - 1)}><Minus className="h-4 w-4" /></Button>
                                                        <span className="w-6 text-center font-bold text-sm">{item.quantity}</span>
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

                <DialogFooter className="mt-4 flex flex-row justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button 
                        size="lg" 
                        onClick={handlePlaceOrderClick} 
                        disabled={refillCart.length === 0}
                    >
                        Place Refill Order
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

    