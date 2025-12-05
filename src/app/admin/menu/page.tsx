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
import { PlusCircle, MoreHorizontal, ChevronDown, Plus, Trash2, Pencil } from 'lucide-react';
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
import { useFirestore, useStorage } from '@/firebase';
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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Switch } from '@/components/ui/switch';
import { MenuItem, Store, GListItem, Variant } from '@/lib/types';
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
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';


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
  availability: 'always',
  imageUrl: '',
  publicDescription: '',
  targetStation: undefined,
  taxRate: '',
  trackInventory: false,
  alertLevel: 0,
};

const initialVariantState: Omit<Variant, 'id'> = { name: '', cost: 0, price: 0, barcode: '' };

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [availabilityOptions, setAvailabilityOptions] = useState<GListItem[]>([]);
  const [taxRates, setTaxRates] = useState<GListItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState<Omit<MenuItem, 'id'>>(initialItemState);
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  const [variantFormData, setVariantFormData] = useState<Variant>(() => ({...initialVariantState, id: Date.now().toString()}));
  const [isAddingVariant, setIsAddingVariant] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  
  const [displayValues, setDisplayValues] = useState<{ cost: string, price: string, variantCost: string, variantPrice: string }>({ cost: '', price: '', variantCost: '', variantPrice: '' });
  
  const firestore = useFirestore();
  const storage = useStorage();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore) {
      const menuUnsubscribe = onSnapshot(collection(firestore, 'menu'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MenuItem[];
        setItems(itemsData.map(item => ({ ...item, storeIds: item.storeIds || [], variants: item.variants || [] })));
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
      
      const taxRateQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'tax rates'),
        where('is_active', '==', true),
        where('storeIds', 'array-contains', selectedStoreId)
      );

      const taxRateUnsubscribe = onSnapshot(taxRateQuery, (snapshot) => {
        const taxRateData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GListItem[];
        setTaxRates(taxRateData);
      });
      
      return () => {
        availabilityUnsubscribe();
        taxRateUnsubscribe();
      }
    }
  }, [firestore, selectedStoreId]);


  useEffect(() => {
    if (editingItem) {
      const variants = editingItem.variants || [];
      setFormData({
        ...initialItemState,
        ...editingItem,
        variants
      });
      setDisplayValues({
        cost: formatCurrency(editingItem.cost),
        price: formatCurrency(editingItem.price),
        variantCost: '',
        variantPrice: ''
      });
    } else {
        setFormData(initialItemState);
        setDisplayValues({
          cost: formatCurrency(initialItemState.cost),
          price: formatCurrency(initialItemState.price),
          variantCost: '',
          variantPrice: ''
        })
    }
    setImageFile(null);
  }, [editingItem]);
  
   useEffect(() => {
    if (!isModalOpen) {
      setEditingItem(null);
      setFormData(initialItemState);
      setDisplayValues({ cost: '', price: '', variantCost: '', variantPrice: '' });
      setIsAddingVariant(false);
      setEditingVariantId(null);
      setVariantFormData({ ...initialVariantState, id: Date.now().toString() });
    }
  }, [isModalOpen]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    const { type } = e.target as HTMLInputElement;

     if (type === 'number') {
        setFormData((prev) => ({ ...prev, [name]: value === '' ? '' : Number(value) }));
    } else {
        setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };
  
  const handleCurrencyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = value.replace(/[^0-9.]/g, '');
    
    if (name === 'variantCost' || name === 'variantPrice') {
       setDisplayValues(prev => ({ ...prev, [name]: numericValue }));
       setVariantFormData(prev => ({ ...prev, [name.replace('variant','')]: parseCurrency(numericValue) }));
    } else {
       setDisplayValues(prev => ({ ...prev, [name]: numericValue }));
       setFormData(prev => ({ ...prev, [name]: parseCurrency(numericValue) }));
    }
  }

  const handleCurrencyInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = parseCurrency(value);
     if (name === 'variantCost' || name === 'variantPrice') {
        setDisplayValues(prev => ({ ...prev, [name]: formatCurrency(numericValue) }));
     } else {
        setDisplayValues(prev => ({ ...prev, [name]: formatCurrency(numericValue) }));
     }
  }
  
  const handleCurrencyInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
     if (name === 'variantCost' || name === 'variantPrice') {
        const fieldName = name.replace('variant','');
        // @ts-ignore
        const fieldValue = variantFormData[fieldName];
        setDisplayValues(prev => ({ ...prev, [name]: fieldValue === 0 ? '' : String(fieldValue) }));
     } else {
        // @ts-ignore
        const fieldValue = formData[name];
        setDisplayValues(prev => ({ ...prev, [name]: fieldValue === 0 ? '' : String(fieldValue) }));
     }
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStoreIdChange = (storeId: string) => {
    setFormData((prev) => {
      const newStoreIds = prev.storeIds.includes(storeId)
        ? prev.storeIds.filter(id => id !== storeId)
        : [...prev.storeIds, storeId];
      return { ...prev, storeIds: newStoreIds };
    });
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData((prev) => ({ ...prev, [name]: checked }));
  }

  const handleAddVariant = () => {
    if (editingVariantId) { // We are saving an edit
        setFormData(prev => ({
            ...prev,
            variants: prev.variants.map(v => v.id === editingVariantId ? variantFormData : v)
        }));
        setEditingVariantId(null);
    } else { // We are adding a new one
        setFormData(prev => ({
            ...prev,
            variants: [...prev.variants, variantFormData]
        }));
    }
    setVariantFormData({ ...initialVariantState, id: Date.now().toString() });
    setDisplayValues(prev => ({...prev, variantCost: '', variantPrice: ''}));
    setIsAddingVariant(false);
  };
  
  const handleEditVariant = (variant: Variant) => {
    setEditingVariantId(variant.id);
    setVariantFormData(variant);
    setDisplayValues(prev => ({
      ...prev,
      variantCost: formatCurrency(variant.cost),
      variantPrice: formatCurrency(variant.price)
    }));
    setIsAddingVariant(true);
  };

  const handleDeleteVariant = (variantId: string) => {
      setFormData(prev => ({
          ...prev,
          variants: prev.variants.filter(v => v.id !== variantId)
      }));
  };

  const handleCancelVariant = () => {
    setVariantFormData({ ...initialVariantState, id: Date.now().toString() });
    setDisplayValues(prev => ({...prev, variantCost: '', variantPrice: ''}));
    setIsAddingVariant(false);
    setEditingVariantId(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage) return;

    let imageUrl = formData.imageUrl || '';
    if (imageFile) {
        const imageRef = ref(storage, `Shareat Hub/menu_items/${Date.now()}_${imageFile.name}`);
        const snapshot = await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(snapshot.ref);
    }
    
    const dataToSave = { ...formData, imageUrl, variants: formData.variants.map(({id, ...rest}) => rest) };

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'menu', editingItem.id);
        await updateDoc(itemRef, dataToSave);
      } else {
        await addDoc(collection(firestore, 'menu'), dataToSave);
      }
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

  const calculateProfit = (cost: number, price: number) => {
    if (price <= cost || price <= 0) return '0.00%';
    const profit = ((price - cost) / price) * 100;
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
          <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit Menu Item' : 'Add New Menu Item'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="menuName">Menu Name</Label>
                        <Input id="menuName" name="menuName" value={formData.menuName} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required />
                    </div>
                </div>

                {/* Variants Section */}
                <div className="space-y-2">
                    <Label>Variants</Label>
                    <div className="space-y-2 rounded-md border p-2">
                        {formData.variants.map(variant => (
                            <div key={variant.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                                <span className="flex-1 font-medium">{variant.name}</span>
                                <span className="text-sm">{formatCurrency(variant.price)}</span>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEditVariant(variant)}><Pencil className="h-4 w-4"/></Button>
                                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteVariant(variant.id)}><Trash2 className="h-4 w-4"/></Button>
                            </div>
                        ))}

                        {isAddingVariant && (
                           <div className="p-2 space-y-4">
                                <h4 className="font-medium">{editingVariantId ? 'Edit Variant' : 'Add New Variant'}</h4>
                                <div className="grid grid-cols-2 gap-4">
                                     <div className="space-y-2">
                                        <Label htmlFor="variantName">Variant Name</Label>
                                        <Input id="variantName" value={variantFormData.name} onChange={(e) => setVariantFormData(prev => ({...prev, name: e.target.value}))}/>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="variantBarcode">Barcode</Label>
                                        <Input id="variantBarcode" value={variantFormData.barcode} onChange={(e) => setVariantFormData(prev => ({...prev, barcode: e.target.value}))} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="variantCost">Cost</Label>
                                        <Input id="variantCost" name="variantCost" value={displayValues.variantCost} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="variantPrice">Price</Label>
                                        <Input id="variantPrice" name="variantPrice" value={displayValues.variantPrice} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button type="button" variant="ghost" onClick={handleCancelVariant}>Cancel</Button>
                                    <Button type="button" onClick={handleAddVariant}>{editingVariantId ? 'Save Variant' : 'Add Variant'}</Button>
                                </div>
                           </div>
                        )}
                        {!isAddingVariant && (
                            <Button type="button" variant="outline" size="sm" onClick={() => setIsAddingVariant(true)}>
                                <Plus className="mr-2 h-4 w-4" /> Add Variant
                            </Button>
                        )}
                    </div>
                </div>


                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                    <Label htmlFor="cost">Base Cost</Label>
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
                    <Label htmlFor="price">Base Price</Label>
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
                        <Label htmlFor="barcode">Base Barcode</Label>
                        <Input id="barcode" name="barcode" value={formData.barcode} onChange={handleInputChange} />
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
                        <Select name="availability" value={formData.availability} onValueChange={(value) => handleSelectChange('availability', value)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select availability" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="always">Always Available</SelectItem>
                                {availabilityOptions.map(option => (
                                    <SelectItem key={option.id} value={option.item}>{option.item}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="targetStation">Target Station</Label>
                    <Select name="targetStation" value={formData.targetStation} onValueChange={(value) => handleSelectChange('targetStation', value)}>
                        <SelectTrigger><SelectValue placeholder="Select station"/></SelectTrigger>
                        <SelectContent>
                        <SelectItem value="Hot">Hot</SelectItem>
                        <SelectItem value="Cold">Cold</SelectItem>
                        </SelectContent>
                    </Select>
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="taxRate">Tax Rate</Label>
                    <Select name="taxRate" value={formData.taxRate} onValueChange={(value) => handleSelectChange('taxRate', value)}>
                        <SelectTrigger><SelectValue placeholder="Select tax rate"/></SelectTrigger>
                        <SelectContent>
                        {taxRates.length > 0 ? taxRates.map(rate => (
                            <SelectItem key={rate.id} value={rate.item}>{rate.item}</SelectItem>
                        )) : <SelectItem value="no-rates" disabled>No tax rates for this store</SelectItem>}
                        </SelectContent>
                    </Select>
                    </div>
                    <div className="md:col-span-2 space-y-2">
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
                    <Switch id="is_active" name="is_active" checked={formData.is_active} onCheckedChange={(c) => handleSwitchChange('is_active', c)} />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                        <Label htmlFor="imageUrl">Image</Label>
                        <Input id="imageUrl" name="imageUrl" type="file" onChange={handleFileChange} />
                    </div>
                    <div className="md:col-span-3 space-y-2">
                        <Label htmlFor="publicDescription">Public Description</Label>
                        <Textarea id="publicDescription" name="publicDescription" value={formData.publicDescription} onChange={handleInputChange} />
                    </div>
                    <div className="md:col-span-3 flex items-center gap-4">
                        <div className="flex items-center space-x-2">
                        <Label htmlFor="trackInventory">Track Inventory</Label>
                        <Switch id="trackInventory" name="trackInventory" checked={!!formData.trackInventory} onCheckedChange={(c) => handleSwitchChange('trackInventory', c)} />
                        </div>
                        {formData.trackInventory && (
                            <div className="flex items-center space-x-2">
                                <Label htmlFor="alertLevel">Alert Level</Label>
                                <Input id="alertLevel" name="alertLevel" type="number" value={formData.alertLevel} onChange={handleInputChange} className="w-24" />
                            </div>
                        )}
                    </div>
                    {formData.trackInventory && (
                        <div className="md:col-span-3">
                            <Alert>
                                <AlertDescription>
                                    Low stock alerts will be triggered when the quantity in stock reaches the alert level.
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}
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
                        <TableHead className="px-2 h-10">Target Station</TableHead>
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
                             {item.variants.map(v => <Badge key={v.id} variant="outline" className="mr-1 mb-1">{v.name}</Badge>)}
                          </TableCell>
                          <TableCell className="p-2">
                             <Badge variant="default" className="mr-1 mb-1">{item.availability || 'Always'}</Badge>
                          </TableCell>
                          <TableCell className="p-2 capitalize">{item.targetStation}</TableCell>
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
