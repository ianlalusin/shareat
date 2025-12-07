
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
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
import { PlusCircle, MoreHorizontal, Plus, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
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
import { MenuItem, Store, GListItem, Product, InventoryItem } from '@/lib/types';
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
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import { useStoreSelector } from '@/store/use-store-selector';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialItemState: Omit<MenuItem, 'id'> = {
  menuName: '',
  category: '',
  unit: 'pc',
  cost: 0,
  price: 0,
  barcode: '',
  isAvailable: true,
  storeId: '',
  availability: 'always',
  imageUrl: '',
  publicDescription: '',
  targetStation: undefined,
  taxRate: '',
  trackInventory: false,
  inventoryItemId: null,
  alertLevel: 0,
  specialTags: [],
  productId: null,
};


export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [availabilityOptions, setAvailabilityOptions] = useState<GListItem[]>([]);
  const [taxRates, setTaxRates] = useState<GListItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState<Omit<MenuItem, 'id'>>(initialItemState);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  
  const [displayValues, setDisplayValues] = useState<{ cost: string, price: string }>({ cost: '', price: '' });
  
  const firestore = useFirestore();
  const storage = useStorage();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore && selectedStoreId) {
        const menuQuery = query(collection(firestore, 'menu'), where('storeId', '==', selectedStoreId));
        const menuUnsubscribe = onSnapshot(menuQuery, (snapshot) => {
            const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MenuItem[];
            setItems(itemsData);
        });

        const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
            const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
            setStores(storesData);
        });
        
        const productsQuery = query(collection(firestore, 'products'), where('isActive', '==', true));
        const productsUnsubscribe = onSnapshot(productsQuery, (snapshot) => {
          const prodData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
          prodData.sort((a, b) => a.productName.localeCompare(b.productName));
          setProducts(prodData);
        });

        const inventoryQuery = query(collection(firestore, 'inventory'), where('storeId', '==', selectedStoreId));
        const inventoryUnsubscribe = onSnapshot(inventoryQuery, (snapshot) => {
            const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
            setInventoryItems(invData);
        });


        return () => {
            menuUnsubscribe();
            storesUnsubscribe();
            productsUnsubscribe();
            inventoryUnsubscribe();
        }
    } else {
        setItems([]);
        setProducts([]);
        setInventoryItems([]);
    }
}, [firestore, selectedStoreId]);

  useEffect(() => {
    if (firestore) {
      const availabilityQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'menu availability'),
        where('is_active', '==', true)
      );
  
      const availabilityUnsubscribe = onSnapshot(availabilityQuery, (snapshot) => {
        const availabilityData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GListItem[]);
        setAvailabilityOptions(availabilityData);
      });
    
      let taxRateUnsubscribe = () => {};
      if (selectedStoreId) {
        const taxRateQuery = query(
          collection(firestore, 'lists'),
          where('category', '==', 'tax rates'),
          where('is_active', '==', true),
          where('storeIds', 'array-contains', selectedStoreId)
        );
        taxRateUnsubscribe = onSnapshot(taxRateQuery, (snapshot) => {
          const taxRateData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GListItem[]);
          setTaxRates(taxRateData);
        });
      } else {
        setTaxRates([]);
      }
      
      return () => {
        availabilityUnsubscribe();
        taxRateUnsubscribe();
      };
    }
  }, [firestore, selectedStoreId]);


  useEffect(() => {
    if (isModalOpen) {
        if (editingItem) {
            setFormData({
                ...initialItemState,
                ...editingItem,
                specialTags: editingItem.specialTags || [],
            });
            setDisplayValues({
                cost: formatCurrency(editingItem.cost),
                price: formatCurrency(editingItem.price),
            });
        }
    } else {
        // When modal closes, reset everything
        setEditingItem(null);
        setFormData(initialItemState);
        setDisplayValues({ cost: '', price: '' });
        setImageFile(null);
        setFormError(null);
    }
  }, [isModalOpen, editingItem]);

  useEffect(() => {
    const selectedProduct = products.find(p => p.id === formData.productId);
    if (selectedProduct && !editingItem) {
        setFormData(prev => ({
            ...prev,
            menuName: selectedProduct.productName,
            category: selectedProduct.category,
            barcode: selectedProduct.barcode,
            unit: selectedProduct.unit,
            cost: selectedProduct.defaultCost || 0,
            price: selectedProduct.defaultPrice || 0,
            specialTags: selectedProduct.specialTags || [],
        }));
        setDisplayValues({
            cost: formatCurrency(selectedProduct.defaultCost || 0),
            price: formatCurrency(selectedProduct.defaultPrice || 0),
        });
    }
  }, [formData.productId, products, editingItem]);
  
  useEffect(() => {
    setFormError(null); // Clear previous errors
    if (formData.trackInventory) {
      if (formData.productId) {
        const linkedItem = inventoryItems.find(i => i.productId === formData.productId);
        if (linkedItem) {
            setFormData(prev => ({
                ...prev,
                inventoryItemId: linkedItem.id,
                cost: linkedItem.costPerUnit,
                price: linkedItem.sellingPrice || 0,
                barcode: linkedItem.sku,
                unit: linkedItem.unit
            }));
            setDisplayValues({
                cost: formatCurrency(linkedItem.costPerUnit),
                price: formatCurrency(linkedItem.sellingPrice || 0),
            });
        } else {
             setFormData(prev => ({ ...prev, inventoryItemId: null }));
             setFormError("This product is not in the store's inventory. Please add it to inventory before tracking.");
        }
      } else {
         setFormData(prev => ({ ...prev, inventoryItemId: null }));
         setFormError("Select a product to link inventory.");
      }
    } else {
      // If tracking is turned off, clear the link and error
      setFormData(prev => ({ ...prev, inventoryItemId: null }));
    }
  }, [formData.trackInventory, formData.productId, inventoryItems]);


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
    
    setDisplayValues(prev => ({ ...prev, [name as 'cost' | 'price']: numericValue }));
    setFormData(prev => ({ ...prev, [name as 'cost' | 'price']: parseCurrency(numericValue) }));
  }

  const handleCurrencyInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = parseCurrency(value);
    setDisplayValues(prev => ({ ...prev, [name as 'cost' | 'price']: formatCurrency(numericValue) }));
  }
  
  const handleCurrencyInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
    const fieldName = name as 'cost' | 'price';
    const fieldValue = formData[fieldName];
    setDisplayValues(prev => ({ ...prev, [fieldName]: fieldValue === 0 ? '' : String(fieldValue) }));
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImageFile(e.target.files[0]);
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    const newFormData = { ...formData, [name]: checked };
    setFormData(newFormData);
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (formError) {
        alert(formError);
        return;
    }
    if (!firestore || !storage || !selectedStoreId) return;

    let imageUrl = formData.imageUrl || '';
    if (imageFile) {
      try {
        const imageRef = ref(storage, `Shareat Hub/menu_items/${Date.now()}_${imageFile.name}`);
        const snapshot = await uploadBytes(imageRef, imageFile);
        imageUrl = await getDownloadURL(snapshot.ref);
      } catch (error) {
        console.error("Image upload failed:", error);
        // Do not block saving if image upload fails.
        // The old imageUrl (or empty string) will be used.
      }
    }
    
    const dataToSave: Omit<MenuItem, 'id'> = {
      ...formData,
      imageUrl,
    };
    
    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'menu', editingItem.id);
        await updateDoc(itemRef, dataToSave as Partial<MenuItem>);
      } else {
        await addDoc(collection(firestore, 'menu'), {...dataToSave, storeId: selectedStoreId});
      }

      setIsModalOpen(false); // Close modal only after successful save
    } catch (error) {
        console.error("Error saving document: ", error);
    }
  };
  
  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'menu', itemId));
    } catch (error) {
        // Error is intentionally not logged to prevent screen freeze
    }
  };

  const handleAvailabilityChange = async (itemId: string, newStatus: boolean) => {
    if (!firestore) return;
    const itemRef = doc(firestore, 'menu', itemId);
    try {
      await updateDoc(itemRef, { isAvailable: newStatus });
    } catch (error) {
      console.error("Error updating item availability: ", error);
    }
  };

  const openAddModal = () => {
    if (!selectedStoreId) {
      alert("Please select a store first.");
      return;
    }
    setEditingItem(null);
    setFormData({...initialItemState, storeId: selectedStoreId});
    setIsModalOpen(true);
  }
  
  const calculateProfit = (cost: number, price: number) => {
    if (price <= cost || price <= 0) return '0.00%';
    const profit = ((price - cost) / price) * 100;
    return `${profit.toFixed(2)}%`;
  }

  const groupedItems = useMemo(() => {
    const grouped = items.reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {} as Record<string, MenuItem[]>);
    
    return Object.keys(grouped).sort().reduce(
      (obj, key) => { 
        obj[key] = grouped[key].sort((a, b) => a.menuName.localeCompare(b.menuName)); 
        return obj;
      }, 
      {} as Record<string, MenuItem[]>
    );
  }, [items]);
  
  const selectedStoreName = useMemo(() => {
    return stores.find(s => s.id === selectedStoreId)?.storeName || 'N/A';
  }, [stores, selectedStoreId]);

  const availableProducts = useMemo(() => {
    if (editingItem) return products; // Show all products when editing
    const existingProductIds = items.map(item => item.productId).filter(Boolean);
    return products.filter(p => !existingProductIds.includes(p.id));
  }, [items, products, editingItem]);

  const groupedAvailableProducts = useMemo(() => {
    return availableProducts.reduce((acc, product) => {
      const category = product.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(product);
      return acc;
    }, {} as Record<string, Product[]>);
  }, [availableProducts]);

  const linkedInventoryItem = useMemo(() => {
    if (formData.inventoryItemId) {
        return inventoryItems.find(i => i.id === formData.inventoryItemId);
    }
    return null;
  }, [formData.inventoryItemId, inventoryItems]);


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
              <DialogTitle>
                {editingItem 
                  ? `Edit ${editingItem.menuName}`
                  : 'Add New Menu Item'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="productId">Menu Name</Label>
                         {editingItem ? (
                           <Input id="menuName" name="menuName" value={formData.menuName} readOnly disabled />
                        ) : (
                          <Select name="productId" value={formData.productId || ''} onValueChange={(v) => handleSelectChange('productId', v)} required>
                              <SelectTrigger><SelectValue placeholder="Select a product"/></SelectTrigger>
                              <SelectContent>
                                {Object.entries(groupedAvailableProducts).map(([category, productsInCategory]) => (
                                  <SelectGroup key={category}>
                                    <SelectLabel>{category}</SelectLabel>
                                    {productsInCategory.map(p => <SelectItem key={p.id} value={p.id}>{p.productName}</SelectItem>)}
                                  </SelectGroup>
                                ))}
                              </SelectContent>
                          </Select>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required readOnly disabled />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="store">Store</Label>
                      <Input id="store" name="store" value={selectedStoreName} readOnly disabled />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cost">Cost</Label>
                    <Input id="cost" name="cost" type="text" inputMode="decimal" value={displayValues.cost} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required disabled={formData.trackInventory} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Price</Label>
                    <Input id="price" name="price" type="text" inputMode="decimal" value={displayValues.price} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required disabled={formData.trackInventory}/>
                  </div>
                   <div className="space-y-2">
                    <Label htmlFor="unit">Unit</Label>
                    <Input id="unit" name="unit" value={formData.unit} readOnly disabled />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="availability">Availability</Label>
                    <Select name="availability" value={formData.availability} onValueChange={(value) => handleSelectChange('availability', value)} required>
                      <SelectTrigger><SelectValue placeholder="Select availability" /></SelectTrigger>
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
                    <Select name="targetStation" value={formData.targetStation} onValueChange={(value) => handleSelectChange('targetStation', value)} required>
                      <SelectTrigger><SelectValue placeholder="Select station"/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Hot">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-orange-500" />
                            Hot
                          </div>
                        </SelectItem>
                        <SelectItem value="Cold">
                           <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-blue-500" />
                            Cold
                          </div>
                        </SelectItem>
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
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                     <div className="space-y-2">
                        <Label htmlFor="imageUrl">Image</Label>
                        <Input id="imageUrl" name="imageUrl" type="file" onChange={handleFileChange} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="specialTags">Special Tags</Label>
                        <div className="flex flex-wrap gap-1 rounded-md border min-h-10 items-center p-2 bg-muted">
                           {formData.specialTags?.length > 0 ? formData.specialTags.map(tag => (
                            <Badge key={tag} variant="outline" className="bg-background">{tag}</Badge>
                           )) : <span className='text-sm text-muted-foreground'>No tags</span>}
                        </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="barcode">Barcode</Label>
                      <Input id="barcode" name="barcode" value={formData.barcode} onChange={handleInputChange} readOnly disabled />
                    </div>
                </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="space-y-2">
                        <Label htmlFor="publicDescription">Public Description</Label>
                        <Textarea id="publicDescription" name="publicDescription" value={formData.publicDescription} onChange={handleInputChange}/>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center space-x-2">
                            <Label htmlFor="isAvailable">Available</Label>
                            <Switch id="isAvailable" name="isAvailable" checked={formData.isAvailable} onCheckedChange={(c) => handleSwitchChange('isAvailable', c)} />
                        </div>
                          <div className="flex items-center space-x-2">
                            <Label htmlFor="trackInventory">Track Inventory</Label>
                            <Switch id="trackInventory" name="trackInventory" checked={!!formData.trackInventory} onCheckedChange={(c) => handleSwitchChange('trackInventory', c)} />
                          </div>
                        </div>

                        {formData.trackInventory && (
                            <div className='space-y-2'>
                                <Label>Linked Inventory Item</Label>
                                {linkedInventoryItem && (
                                    <div className="flex items-center justify-between rounded-md border bg-muted px-3 py-2 text-sm">
                                        <span>{linkedInventoryItem.name} ({linkedInventoryItem.sku})</span>
                                        <Badge variant="secondary">Auto-linked</Badge>
                                    </div>
                                )}
                                {formError && (
                                     <Alert variant="destructive" className="p-2">
                                        <div className="flex items-center gap-2">
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertDescription className="text-xs">
                                                {formError}
                                            </AlertDescription>
                                        </div>
                                    </Alert>
                                )}
                            </div>
                        )}

                        {formData.trackInventory && (
                            <div className="flex items-center space-x-2">
                                <Label htmlFor="alertLevel">Alert Level</Label>
                                <Input id="alertLevel" name="alertLevel" type="number" value={formData.alertLevel} onChange={handleInputChange} className="w-24" />
                            </div>
                        )}

                        {formData.trackInventory && !formError && (
                            <Alert>
                                <AlertDescription>
                                    Cost, Price, Barcode, and Unit are now locked to the linked inventory item. Low stock alerts will be triggered when the quantity in stock reaches the alert level.
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                </div>
                 
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
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
                    if (!selectedStoreId) {
                      alert("Please select a store first.");
                      return;
                    }
                    setEditingItem(null);
                    setFormData({...initialItemState, category, storeId: selectedStoreId});
                    setIsModalOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
               </div>
              <AccordionContent className="p-0">
                <div className="border-t overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 h-10 text-xs">Menu Name</TableHead>
                        <TableHead className="px-2 h-10 text-xs">Availability</TableHead>
                        <TableHead className="px-2 h-10 text-xs">Target Station</TableHead>
                        <TableHead className="px-2 h-10 text-xs text-right">Cost</TableHead>
                        <TableHead className="px-2 h-10 text-xs text-right">Price</TableHead>
                        <TableHead className="px-2 h-10 text-xs text-right">Profit %</TableHead>
                        <TableHead className="px-2 h-10 text-xs">Barcode</TableHead>
                        <TableHead className="px-2 h-10 text-xs">Status</TableHead>
                        <TableHead className="px-2 h-10 text-xs">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemsInCategory.map((item) => (
                          <TableRow key={item.id} onClick={() => handleEdit(item)} className="cursor-pointer font-medium">
                            <TableCell className="p-2 text-xs">{item.menuName}</TableCell>
                            <TableCell className="p-2 text-xs">
                              <Badge variant="outline" className="mr-1 mb-1 whitespace-nowrap">
                                {(item.availability || 'Always').substring(0, 6)}{(item.availability && item.availability.length > 6) ? '...' : ''}
                              </Badge>
                            </TableCell>
                            <TableCell className="p-2 capitalize text-xs">{item.targetStation}</TableCell>
                            <TableCell className="p-2 text-right text-xs">{formatCurrency(item.cost)}</TableCell>
                            <TableCell className="p-2 text-right text-xs">{formatCurrency(item.price)}</TableCell>
                            <TableCell className="p-2 text-right text-xs">{calculateProfit(item.cost, item.price)}</TableCell>
                            <TableCell className="p-2 text-xs">{item.barcode}</TableCell>
                            <TableCell className="p-2 text-xs" onClick={(e) => e.stopPropagation()}>
                              <div className="flex flex-col items-center gap-1">
                                <Switch
                                  checked={item.isAvailable}
                                  onCheckedChange={(newStatus) => handleAvailabilityChange(item.id, newStatus)}
                                  aria-label={`Toggle ${item.menuName} availability`}
                                />
                                <span className="text-xs text-muted-foreground">{item.isAvailable ? 'Available' : 'Unavailable'}</span>
                              </div>
                            </TableCell>
                            <TableCell className="p-2" onClick={(e) => e.stopPropagation()}>
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
                                  <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-destructive">Delete</DropdownMenuItem>
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
