

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
import { Label } from '@/components/ui/label';
import { PlusCircle, Minus, Plus, ChevronDown, Loader2 } from 'lucide-react';
import { Table as TableType, MenuItem, Order, OrderItem, CollectionItem, Schedule } from '@/lib/types';
import { useFirestore } from '@/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '../ui/textarea';

interface NewOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    table: TableType;
    menu: MenuItem[];
    schedules: CollectionItem[];
    storeId: string;
    onCreateOrder: (table: TableType, orderData: {
      customerName: string;
      guestCount: number;
      selectedPackage: MenuItem;
      selectedFlavors: string[];
      kitchenNote?: string;
    }) => Promise<void>;
}

export function NewOrderModal({ isOpen, onClose, table, menu, schedules, storeId, onCreateOrder }: NewOrderModalProps) {
    const [customerName, setCustomerName] = useState('');
    const [guestCount, setGuestCount] = useState(2);
    const [selectedPackage, setSelectedPackage] = useState<MenuItem | null>(null);
    const [selectedFlavors, setSelectedFlavors] = useState<string[]>([]);
    const [flavorOptions, setFlavorOptions] = useState<CollectionItem[]>([]);
    const [kitchenNote, setKitchenNote] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const firestore = useFirestore();

    const packages = useMemo(() => {
      if (!menu || menu.length === 0) return [];
    
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
        now.getMinutes()
      ).padStart(2, '0')}`;
      const currentDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    
      const activeScheduleNames = new Set(
        schedules
          .map((s) => s as unknown as Schedule)
          .filter((schedule) => {
            if(!schedule.days || !schedule.startTime || !schedule.endTime) return false;
            const dayMatch = schedule.days.includes(currentDay);
    
            const start = schedule.startTime; // "HH:MM"
            const end = schedule.endTime;     // "HH:MM"
            const nowT = currentTime;
    
            // handle both normal and overnight windows
            const timeMatch =
              start <= end
                ? nowT >= start && nowT <= end      // e.g. 10:00–14:00
                : nowT >= start || nowT <= end;     // e.g. 17:00–01:00
    
            return schedule.is_active && dayMatch && timeMatch;
          })
          .map((s) => s.item) // e.g. "Lunch Time", "Dinner Time"
      );
    
      return menu.filter((item) => {
        if (item.category !== 'Package') return false;
        if (!item.isAvailable) return false;
        if (item.storeId !== storeId) return false;
        if (item.availability === 'always') return true;
        return activeScheduleNames.has(item.availability);
      });
    }, [menu, schedules, storeId]);
    
    useEffect(() => {
        if(!isOpen || !firestore || !storeId) return;

        const flavorsQuery = query(
            collection(firestore, 'lists'),
            where('category', '==', 'flavors'),
            where('is_active', '==', true),
            where('storeIds', 'array-contains', storeId)
        );
        const unsubscribe = onSnapshot(flavorsQuery, (snapshot) => {
            const flavors = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as CollectionItem);
            setFlavorOptions(flavors);
        });
        return () => unsubscribe();
        
    }, [isOpen, firestore, storeId]);

    useEffect(() => {
        // Reset state when modal opens
        if (isOpen) {
            setCustomerName('');
            setGuestCount(2);
            setSelectedPackage(null);
            setSelectedFlavors([]);
            setKitchenNote('');
            setError(null);
            setIsSubmitting(false);
        }
    }, [isOpen]);

    const handleOpenChange = (open: boolean) => {
        if (!open) {
            onClose();
        }
    };

    const handlePackageChange = (menuItemId: string) => {
      const pkg = packages.find((p) => p.id === menuItemId);
      setSelectedPackage(pkg || null);
    };

    const handleFlavorSelect = (flavor: string) => {
      setSelectedFlavors((prev) => {
        const isSelected = prev.includes(flavor);
        if (isSelected) {
          return prev.filter((f) => f !== flavor);
        } else {
          if (prev.length < 3) {
            return [...prev, flavor];
          }
          return prev;
        }
      });
    };
    
    const getSelectedFlavorText = () => {
      if (selectedFlavors.length === 0) return 'Select 1–3 flavors';
      if (selectedFlavors.length > 2) return `${selectedFlavors.length} flavors selected`;
      return selectedFlavors.join(', ');
    };
    
    const handleStartOrder = async () => {
        if (!selectedPackage || selectedFlavors.length === 0) {
            setError("Please ensure a Package and at least one Flavor are selected.");
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await onCreateOrder(table, {
                customerName,
                guestCount,
                selectedPackage,
                selectedFlavors,
                kitchenNote,
            });
            onClose();
        } catch (e) {
            console.error("Failed to start order:", e);
            setError(e instanceof Error ? e.message : "Failed to start the order. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    }


    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>New Order: {table?.tableName}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto px-1">
                <div className="space-y-2">
                    <Label htmlFor="customerName">Customer Name</Label>
                    <Input id="customerName" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                </div>
                
                 <div className="grid grid-cols-5 gap-4">
                    <div className="space-y-2 col-span-2">
                         <Label htmlFor="guestCount">Guests</Label>
                        <div className="flex items-center gap-1">
                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setGuestCount(c => Math.max(1, c - 1))}><Minus className="h-4 w-4"/></Button>
                            <Input id="guestCount" type="number" value={guestCount} onChange={e => setGuestCount(Number(e.target.value))} min="1" required className="w-full text-center h-10" />
                            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setGuestCount(c => c + 1)}><Plus className="h-4 w-4"/></Button>
                        </div>
                    </div>
                     <div className="space-y-2 col-span-3">
                        <Label htmlFor="package">Package</Label>
                        <Select onValueChange={handlePackageChange} value={selectedPackage?.id}>
                            <SelectTrigger className="h-10">
                                <SelectValue placeholder="Choose package..." />
                            </SelectTrigger>
                            <SelectContent>
                                {packages.map((pkg) => (
                                  <SelectItem key={pkg.id} value={pkg.id}>
                                    {pkg.menuName}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                
                <div className="space-y-2">
                    <Label htmlFor="flavor">Flavor (select 1–3)</Label>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-between h-10">
                                <span>{getSelectedFlavorText()}</span>
                                <ChevronDown className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                            {flavorOptions.map(opt => (
                                <DropdownMenuCheckboxItem
                                    key={opt.id}
                                    checked={selectedFlavors.includes(opt.item)}
                                    onSelect={(e) => e.preventDefault()}
                                    onClick={() => handleFlavorSelect(opt.item)}
                                    disabled={
                                        !selectedFlavors.includes(opt.item) && selectedFlavors.length >= 3
                                      }
                                >
                                    {opt.item}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                
                <div className="space-y-2">
                    <Label htmlFor="kitchenNote">Kitchen Note (Optional)</Label>
                    <Textarea id="kitchenNote" value={kitchenNote} onChange={e => setKitchenNote(e.target.value)} placeholder="e.g., Allergic to peanuts"/>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

            </div>
            <DialogFooter className="flex-row justify-end gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button onClick={handleStartOrder} disabled={isSubmitting || !selectedPackage || selectedFlavors.length === 0}>
                    {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <PlusCircle className="mr-2 h-4 w-4" />
                    )}
                    {isSubmitting ? 'Starting...' : 'Start Order'}
                </Button>
            </DialogFooter>
        </DialogContent>
        </Dialog>
    )
}
