'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, MoreHorizontal, ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useFirestore } from '@/firebase';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore';
import { Switch } from '@/components/ui/switch';
import { MenuItem, Store, GListItem } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStoreSelector } from '@/store/use-store-selector';
import { formatCurrency, parseCurrency } from '@/lib/utils';


const initialItemState: Omit<MenuItem, 'id'> = {
  menuName: '',
  category: '',
  variants: [],
  sellBy: 'unit',
  cost: 0,
  price: 0,
  barcode: '',
  is_active: true,
  storeIds: [],
  availability: [],
};

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [availabilityOptions, setAvailabilityOptions] = useState<GListItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState<Omit<MenuItem, 'id'>>(initialItemState);
  const [displayValues, setDisplayValues] = useState<{ cost: string, price: string }>({ cost: '', price: '' });
  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore) {
      const menuUnsubscribe = onSnapshot(collection(firestore, 'menu'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MenuItem[];
        setItems(itemsData.map(item => ({ ...item, storeIds: item.storeIds || [], variants: item.variants || [], availability: item.availability || [] })));
      });

      const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });

      return () => {
        menuUnsubscribe();
        storesUnsubscribe();
      }
    }
  }, [firestore]);

  useEffect(() => {
    if (firestore && selectedStoreId) {
       const availabilityQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'menu availability'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', selectedStoreId)
      );

      const availabilityUnsubscribe = onSnapshot(availabilityQuery, (snapshot) => {
        const availabilityData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GListItem[]);
        setAvailabilityOptions(availabilityData);
      });
      
      return () => availabilityUnsubscribe();
    }
  }, [firestore, selectedStoreId]);


  useEffect(() => {
    if (editingItem) {
      setFormData({
        ...editingItem,
        variants: editingItem.variants || [],
        availability: editingItem.availability || [],
      });
      setDisplayValues({
        cost: formatCurrency(editingItem.cost),
        price: formatCurrency(editingItem.price),
      });
    } else {
        setFormData(initialItemState);
        setDisplayValues({
          cost: formatCurrency(initialItemState.cost),
          price: formatCurrency(initialItemState.price),
        })
    }
  }, [editingItem]);
  
   useEffect(() => {
    if (isModalOpen) {
      if (editingItem) {
        setDisplayValues({
          cost: formatCurrency(editingItem.cost),
          price: formatCurrency(editingItem.price)
        });
      } else {
        setDisplayValues({
          cost: formatCurrency(initialItemState.cost),
          price: formatCurrency(initialItemState.price)
        });
      }
    }
  }, [isModalOpen, editingItem]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  
  const handleCurrencyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = value.replace(/[^0-9.]/g, '');
    setDisplayValues(prev => ({ ...prev, [name]: numericValue }));
    setFormData(prev => ({ ...prev, [name]: parseFloat(numericValue) || 0 }));
  }

  const handleCurrencyInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = parseFloat(value) || 0;
    setDisplayValues(prev => ({ ...prev, [name]: formatCurrency(numericValue) }));
  }
  
  const handleCurrencyInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
    const fieldValue = name === 'cost' ? formData.cost : formData.price;
    setDisplayValues(prev => ({ ...prev, [name]: fieldValue === 0 ? '' : String(fieldValue) }));
  }

  const handleVariantsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    setFormData(prev => ({...prev, variants: value.split(',').map(v => v.trim())}));
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value as 'unit' | 'fraction' }));
  };

  const handleStoreIdChange = (storeId: string) => {
    setFormData((prev) => {
      const newStoreIds = prev.storeIds.includes(storeId)
        ? prev.storeIds.filter(id => id !== storeId)
        : [...prev.storeIds, storeId];
      return { ...prev, storeIds: newStoreIds };
    });
  };

  const handleAvailabilityChange = (itemName: string) => {
    setFormData(prev => {
        const newAvailability = prev.availability.includes(itemName)
            ? prev.availability.filter(item => item !== itemName)
            : [...prev.availability, itemName];
        return {...prev, availability: newAvailability};
    })
  }

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, is_active: checked }));
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'menu', editingItem.id);
        await updateDoc(itemRef, formData);
        setEditingItem(null);
      } else {
        await addDoc(collection(firestore, 'menu'), formData);
      }
      setFormData(initialItemState);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };
  
  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    if (window.confirm('Are you sure you want to delete this menu item?')) {
      try {
        await deleteDoc(doc(firestore, 'menu', itemId));
      } catch (error) {
        console.error("Error deleting document: ", error);
      }
    }
  };

  const openAddModal = () => {
    setEditingItem(null);
    setFormData(initialItemState);
    setIsModalOpen(true);
  }
  
  const openAddModalForCategory = (category: string) => {
    setEditingItem(null);
    setFormData({...initialItemState, category});
    setIsModalOpen(true);
  };
  
  const getSelectedStoreNames = () => {
    if (formData.storeIds.length === 0) return "Select stores";
    if (formData.storeIds.length === stores.length) return "All stores selected";
    if (formData.storeIds.length > 2) return `${formData.storeIds.length} stores selected`;
    return stores
        .filter(s => formData.storeIds.includes(s.id))
        .map(s => s.storeName)
        .join(', ');
  };
  
  const getSelectedAvailabilityNames = () => {
    if (formData.availability.length === 0) return "Select availability";
    if (formData.availability.length === availabilityOptions.length) return "All selected";
    if (formData.availability.length > 2) return `${formData.availability.length} selected`;
    return formData.availability.join(', ');
  }

  const calculateProfit = (cost: number, price: number) => {
    if (cost <= 0 || price <= 0) return '0.00%';
    const profit = ((price - cost) / cost) * 100;
    return `${profit.toFixed(2)}%`;
  }

  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  return (
      <main className="flex flex-1 flex-col gap-2 p-2 lg:gap-3 lg:p-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Menu
        </h1>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2" onClick={openAddModal}>
              <PlusCircle className="h-4 w-4" />
              <span>Add Menu Item</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4">
                 <div className="space-y-2">
                  <Label htmlFor="menuName">Menu Name</Label>
                  <Input id="menuName" name="menuName" value={formData.menuName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="barcode">Barcode</Label>
                  <Input id="barcode" name="barcode" value={formData.barcode} onChange={handleInputChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="variants">Variants (comma-separated)</Label>
                  <Input id="variants" name="variants" value={formData.variants.join(', ')} onChange={handleVariantsChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cost">Cost</Label>
                  <Input 
                    id="cost" 
                    name="cost" 
                    type="text"
                    inputMode='decimal'
                    value={displayValues.cost}
                    onChange={handleCurrencyInputChange} 
                    onBlur={handleCurrencyInputBlur}
                    onFocus={handleCurrencyInputFocus}
                    required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="price">Price</Label>
                  <Input 
                    id="price" 
                    name="price" 
                    type="text"
                    inputMode='decimal'
                    value={displayValues.price}
                    onChange={handleCurrencyInputChange}
                    onBlur={handleCurrencyInputBlur}
                    onFocus={handleCurrencyInputFocus}
                    required />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="sellBy">Sell By</Label>
                   <Select name="sellBy" value={formData.sellBy} onValueChange={(value) => handleSelectChange('sellBy', value)} required>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unit">Unit</SelectItem>
                      <SelectItem value="fraction">Fraction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="availability">Availability</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{getSelectedAvailabilityNames()}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        {availabilityOptions.length > 0 ?
                          availabilityOptions.map(option => (
                            <DropdownMenuCheckboxItem
                                key={option.id}
                                checked={formData.availability.includes(option.item)}
                                onSelect={(e) => e.preventDefault()}
                                onClick={() => handleAvailabilityChange(option.item)}
                            >
                                {option.item}
                            </DropdownMenuCheckboxItem>
                          )) :
                          <DropdownMenuItem disabled>No options for this store</DropdownMenuItem>
                        }
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                 <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="storeIds">Applicable Stores</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{getSelectedStoreNames()}</span>
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem onSelect={() => setFormData(prev => ({...prev, storeIds: stores.map(s => s.id)}))}>Select All</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setFormData(prev => ({...prev, storeIds: []}))}>Select None</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {stores.map(store => (
                            <DropdownMenuCheckboxItem
                                key={store.id}
                                checked={formData.storeIds.includes(store.id)}
                                onSelect={(e) => e.preventDefault()}
                                onClick={() => handleStoreIdChange(store.id)}
                            >
                                {store.storeName}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center space-x-2">
                  <Label htmlFor="is_active">Active</Label>
                  <Switch id="is_active" name="is_active" checked={formData.is_active} onCheckedChange={handleSwitchChange} />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit">{editingItem ? 'Save Changes' : 'Save'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      
      <Accordion type="multiple" className="w-full" defaultValue={Object.keys(groupedItems)}>
        {Object.entries(groupedItems).map(([category, itemsInCategory]) => (
          <AccordionItem key={category} value={category} className="border-0">
             <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
               <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                  <div className='flex items-center gap-2'>
                      <h2 className="text-base font-semibold">{category}</h2>
                      <Badge variant="secondary">{itemsInCategory.length}</Badge>
                  </div>
                </AccordionTrigger>
                 <Button
                  size="sm"
                  variant="ghost"
                  className="mr-2 h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    openAddModalForCategory(category);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
               </div>
              <AccordionContent className="p-0">
                <div className="border-t overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 h-10">Menu Name</TableHead>
                        <TableHead className="px-2 h-10">Variants</TableHead>
                        <TableHead className="px-2 h-10">Availability</TableHead>
                        <TableHead className="px-2 h-10">Sell By</TableHead>
                        <TableHead className="px-2 h-10 text-right">Cost</TableHead>
                        <TableHead className="px-2 h-10 text-right">Price</TableHead>
                        <TableHead className="px-2 h-10 text-right">Profit %</TableHead>
                        <TableHead className="px-2 h-10">Barcode</TableHead>
                        <TableHead className="px-2 h-10">Status</TableHead>
                        <TableHead className="px-2 h-10">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemsInCategory.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="p-2 font-medium">{item.menuName}</TableCell>
                          <TableCell className="p-2">
                             {item.variants.map(v => <Badge key={v} variant="outline" className="mr-1 mb-1">{v}</Badge>)}
                          </TableCell>
                          <TableCell className="p-2">
                             {item.availability.map(v => <Badge key={v} variant="default" className="mr-1 mb-1">{v}</Badge>)}
                          </TableCell>
                          <TableCell className="p-2 capitalize">{item.sellBy}</TableCell>
                          <TableCell className="p-2 text-right">{formatCurrency(item.cost)}</TableCell>
                          <TableCell className="p-2 text-right">{formatCurrency(item.price)}</TableCell>
                          <TableCell className="p-2 text-right">{calculateProfit(item.cost, item.price)}</TableCell>
                          <TableCell className="p-2">{item.barcode}</TableCell>
                          <TableCell className="p-2">
                            <Badge
                              variant={item.is_active ? 'default' : 'destructive'}
                              className={item.is_active ? 'bg-green-500' : ''}
                            >
                              {item.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </TableCell>
                          <TableCell className="p-2">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button aria-haspopup="true" size="icon" variant="ghost">
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Toggle menu</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => handleEdit(item)}>Edit</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleDelete(item.id)}>Delete</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AccordionContent>
             </div>
          </AccordionItem>
        ))}
      </Accordion>
      </main>
  );
}
