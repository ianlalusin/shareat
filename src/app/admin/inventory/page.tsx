
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
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
import { PlusCircle, MoreHorizontal, Plus, AlertCircle, TrendingUp, TrendingDown, Image as ImageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFirestore } from '@/firebase';
import {
  collection,
  doc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  addDoc,
  deleteDoc,
} from 'firebase/firestore';
import { InventoryItem, InventoryItemType, Product } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useStoreSelector } from '@/store/use-store-selector';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatCurrency, parseCurrency, UNIT_OPTIONS, formatAndValidateDate, revertToInputFormat, autoformatDate } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Image from 'next/image';
import { BarcodeInput } from '@/components/ui/barcode-input';

type FormData = Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt' | 'storeId' | 'expiryDate'> & {
    expiryDate: string;
};

const initialItemState: FormData = {
    itemType: 'saleable',
    name: '',
    sku: '',
    category: '',
    unit: 'pc',
    currentQty: 0,
    reorderPoint: 0,
    criticalPoint: 0,
    costPerUnit: 0,
    sellingPrice: 0,
    isPerishable: false,
    expiryDate: '',
    trackInventory: true,
    productId: null,
};

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState<any>(initialItemState);
  const [displayValues, setDisplayValues] = useState<{ costPerUnit: string, sellingPrice: string }>({ costPerUnit: '', sellingPrice: '' });
  const [dateError, setDateError] = useState<string | undefined>();
  
  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore && selectedStoreId) {
      const invQuery = query(collection(firestore, 'inventory'), where('storeId', '==', selectedStoreId));
      const invUnsubscribe = onSnapshot(invQuery, (snapshot) => {
        const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
        setInventory(invData);
      });

      const productsQuery = query(collection(firestore, 'products'), where('isActive', '==', true));
      const productsUnsubscribe = onSnapshot(productsQuery, (snapshot) => {
        const prodData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
        prodData.sort((a, b) => a.productName.localeCompare(b.productName));
        setProducts(prodData);
      });

      return () => {
        invUnsubscribe();
        productsUnsubscribe();
      };
    } else {
      setInventory([]);
      setProducts([]);
    }
  }, [firestore, selectedStoreId]);

  const selectedProduct = useMemo(() => {
    return products.find(p => p.id === formData.productId);
  }, [formData.productId, products]);


  useEffect(() => {
    if (selectedProduct && !editingItem) {
        setFormData(prev => ({
            ...prev,
            name: selectedProduct.productName,
            category: selectedProduct.category,
            sku: selectedProduct.barcode,
            unit: selectedProduct.unit,
            costPerUnit: selectedProduct.defaultCost || 0,
            sellingPrice: selectedProduct.defaultPrice || 0,
        }));
        setDisplayValues({
            costPerUnit: formatCurrency(selectedProduct.defaultCost || 0),
            sellingPrice: formatCurrency(selectedProduct.defaultPrice || 0),
        });
    }
  }, [selectedProduct, editingItem]);

  useEffect(() => {
    if (isModalOpen) {
        if (editingItem) {
            let expiryDateStr = '';
            if (editingItem.expiryDate) {
                try {
                    expiryDateStr = formatAndValidateDate(editingItem.expiryDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })).formatted;
                } catch (e) {
                    // handle cases where expiryDate is not a valid Timestamp
                }
            }

            setFormData({
                ...initialItemState,
                ...editingItem,
                expiryDate: expiryDateStr,
            });
            setDisplayValues({
                costPerUnit: formatCurrency(editingItem.costPerUnit),
                sellingPrice: formatCurrency(editingItem.sellingPrice || 0),
            });
        }
    } else {
        setEditingItem(null);
        setFormData(initialItemState);
        setDisplayValues({ costPerUnit: '', sellingPrice: '' });
        setDateError(undefined);
    }
  }, [isModalOpen, editingItem]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
        ...prev,
        [name]: type === 'number' ? (value === '' ? '' : parseFloat(value)) : value
    }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [name]: checked }));
  };
  
  const handleCurrencyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = value.replace(/[^0-9.]/g, '');
    
    setDisplayValues(prev => ({ ...prev, [name as keyof typeof displayValues]: numericValue }));
    setFormData(prev => ({ ...prev, [name as keyof typeof displayValues]: parseCurrency(numericValue) }));
  }

  const handleCurrencyInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = parseCurrency(value);
    setDisplayValues(prev => ({ ...prev, [name as keyof typeof displayValues]: formatCurrency(numericValue) }));
  }

  const handleCurrencyInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name } = e.target;
    const fieldName = name as keyof typeof displayValues;
    const fieldValue = formData[fieldName];
    setDisplayValues(prev => ({ ...prev, [fieldName]: fieldValue === 0 ? '' : String(fieldValue) }));
  }
  
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const previousValue = formData.expiryDate || '';
    const updatedValue = autoformatDate(value, previousValue);

    setFormData((prev) => ({ ...prev, [name]: updatedValue }));
     if (updatedValue === '') {
      setDateError(undefined);
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setFormData(prev => ({ ...prev, [name]: formatted }));
    setDateError(error);
  };
  
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !selectedStoreId) return;

    if (formData.isPerishable && dateError) {
        alert('Please fix the date format.');
        return;
    }

    const { expiryDate, ...restOfData } = formData;
    
    const numericData = {
      ...restOfData,
      currentQty: parseFloat(restOfData.currentQty) || 0,
      reorderPoint: parseFloat(restOfData.reorderPoint) || 0,
      criticalPoint: parseFloat(restOfData.criticalPoint) || 0,
    };

    const dataToSave = {
        ...numericData,
        storeId: selectedStoreId,
        updatedAt: serverTimestamp(),
        expiryDate: formData.isPerishable && expiryDate ? new Date(expiryDate) : null,
    };

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'inventory', editingItem.id);
        await updateDoc(itemRef, dataToSave);
      } else {
        await addDoc(collection(firestore, 'inventory'), {
          ...dataToSave,
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };
  
  const handleEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    await deleteDoc(doc(firestore, 'inventory', itemId));
  };

  const openAddModalForCategory = (category: string) => {
    setEditingItem(null);
    setFormData({...initialItemState, category});
    setIsModalOpen(true);
  };
  
  const getStockLevel = (item: InventoryItem) => {
    if (!item.trackInventory) return <Badge variant="secondary">Not Tracked</Badge>;
    if (item.currentQty <= item.criticalPoint) return <Badge className="bg-red-600 text-white"><AlertCircle className="mr-1 h-3 w-3" /> Critical</Badge>;
    if (item.currentQty <= item.reorderPoint) return <Badge className="bg-yellow-500 text-white"><TrendingDown className="mr-1 h-3 w-3" /> Low Stock</Badge>;
    return <Badge className="bg-green-500 text-white"><TrendingUp className="mr-1 h-3 w-3" /> In Stock</Badge>;
  };
  
  const getProductForInventoryItem = (item: InventoryItem) => {
      return products.find(p => p.id === item.productId);
  }

  const groupedItems = useMemo(() => {
    const grouped = inventory.reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {} as Record<string, InventoryItem[]>);
    
    return Object.keys(grouped).sort().reduce(
      (obj, key) => { 
        obj[key] = grouped[key].sort((a, b) => a.name.localeCompare(b.name)); 
        return obj;
      }, 
      {} as Record<string, InventoryItem[]>
    );
  }, [inventory]);

  const availableProducts = useMemo(() => {
    const existingProductIds = inventory.map(item => item.productId).filter(Boolean);
    return products.filter(p => !existingProductIds.includes(p.id));
  }, [inventory, products]);

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

  return (
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Inventory
        </h1>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
                <Button size="sm" className="flex items-center gap-2" onClick={() => setIsModalOpen(true)} disabled={!selectedStoreId}>
                    <PlusCircle className="h-4 w-4" />
                    <span>Add Inventory Item</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingItem ? `Edit ${editingItem.name}`: 'Add New Inventory Item'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-2 py-4">
                     {/* Image Preview */}
                    {selectedProduct?.imageUrl && (
                        <div className="md:col-span-3 mb-4 flex justify-center">
                            <div className="w-32 h-32 rounded-lg bg-muted overflow-hidden relative">
                                <Image src={selectedProduct.imageUrl} alt={selectedProduct.productName} layout="fill" objectFit="cover" />
                            </div>
                        </div>
                    )}
                    {/* Row 1 */}
                    <div className="space-y-2">
                        <Label htmlFor="productId">Item Name</Label>
                        {editingItem ? (
                           <Input id="name" name="name" value={formData.name} readOnly disabled />
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
                        <Label htmlFor="sku">SKU / Barcode</Label>
                        <BarcodeInput id="sku" name="sku" value={formData.sku} onChange={handleInputChange} readOnly disabled />
                    </div>
                    {/* Row 2 */}
                     <div className="space-y-2">
                        <Label htmlFor="itemType">Item Type</Label>
                        <Select name="itemType" value={formData.itemType} onValueChange={(v) => handleSelectChange('itemType', v)} required>
                           <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="raw">Raw Material</SelectItem>
                                <SelectItem value="saleable">Saleable Item</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="unit">Unit of Measure</Label>
                         <Input id="unit" name="unit" value={formData.unit} readOnly disabled />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="currentQty">Current Quantity</Label>
                        <Input id="currentQty" name="currentQty" type="number" value={formData.currentQty} onChange={handleInputChange} required/>
                    </div>
                    {/* Row 3 */}
                    <div className="space-y-2">
                        <Label htmlFor="reorderPoint">Re-order Point</Label>
                        <Input id="reorderPoint" name="reorderPoint" type="number" value={formData.reorderPoint} onChange={handleInputChange} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="criticalPoint">Critical Point</Label>
                        <Input id="criticalPoint" name="criticalPoint" type="number" value={formData.criticalPoint} onChange={handleInputChange} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="costPerUnit">Cost per Unit</Label>
                        <Input id="costPerUnit" name="costPerUnit" type="text" inputMode='decimal' value={displayValues.costPerUnit} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required/>
                    </div>
                     {/* Row 4 */}
                    {formData.itemType === 'saleable' && (
                        <div className="space-y-2">
                            <Label htmlFor="sellingPrice">Selling Price</Label>
                            <Input id="sellingPrice" name="sellingPrice" type="text" inputMode='decimal' value={displayValues.sellingPrice} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                        </div>
                    )}
                    <div className="flex items-center gap-4 col-span-1">
                        <div className="flex items-center space-x-2 pt-6">
                            <Switch id="isPerishable" name="isPerishable" checked={formData.isPerishable} onCheckedChange={(c) => handleSwitchChange('isPerishable', c)} />
                            <Label htmlFor="isPerishable">Perishable</Label>
                        </div>
                        <div className="flex items-center space-x-2 pt-6">
                            <Switch id="trackInventory" name="trackInventory" checked={formData.trackInventory} onCheckedChange={(c) => handleSwitchChange('trackInventory', c)} />
                            <Label htmlFor="trackInventory">Track</Label>
                        </div>
                    </div>
                    {formData.isPerishable && (
                        <div className="space-y-2">
                            <Label htmlFor="expiryDate">Expiry Date</Label>
                            <Input id="expiryDate" name="expiryDate" value={formData.expiryDate} onChange={handleDateChange} onBlur={handleDateBlur} placeholder="MM/DD/YYYY" maxLength={10} />
                            {dateError && <p className="text-sm text-destructive">{dateError}</p>}
                        </div>
                    )}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingItem ? 'Save Changes' : 'Save Item'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
        </Dialog>
      </div>

       {!selectedStoreId ? (
          <Alert>
            <AlertTitle>No Store Selected</AlertTitle>
            <AlertDescription>Please select a store from the dropdown above to manage its inventory.</AlertDescription>
          </Alert>
        ) : (
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
                            <TableHead className="px-2 h-10 w-16"></TableHead>
                            <TableHead className="px-2 h-10">Name</TableHead>
                            <TableHead className="px-2 h-10">SKU</TableHead>
                            <TableHead className="px-2 h-10">Type</TableHead>
                            <TableHead className="px-2 h-10 text-right">Qty</TableHead>
                            <TableHead className="px-2 h-10">Unit</TableHead>
                            <TableHead className="px-2 h-10 text-right">Cost</TableHead>
                            <TableHead className="px-2 h-10">Stock Level</TableHead>
                            <TableHead className="px-2 h-10">
                              <span className="sr-only">Actions</span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemsInCategory.map((item) => {
                              const product = getProductForInventoryItem(item);
                              return (
                                <TableRow key={item.id} onClick={() => handleEdit(item)} className="cursor-pointer">
                                  <TableCell className="p-2">
                                     <div className="h-10 w-10 flex items-center justify-center rounded-md bg-muted overflow-hidden">
                                        {product?.imageUrl ? (
                                            <Image src={product.imageUrl} alt={item.name} width={40} height={40} className="object-cover h-full w-full" />
                                        ) : (
                                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="p-2 font-medium">{item.name}</TableCell>
                                  <TableCell className="p-2 text-muted-foreground">{item.sku}</TableCell>
                                   <TableCell className="p-2"><Badge variant="outline">{item.itemType}</Badge></TableCell>
                                  <TableCell className="p-2 text-right font-bold text-lg">{item.currentQty}</TableCell>
                                  <TableCell className="p-2">{item.unit}</TableCell>
                                  <TableCell className="p-2 text-right">{formatCurrency(item.costPerUnit)}</TableCell>
                                  <TableCell className="p-2">{getStockLevel(item)}</TableCell>
                                  <TableCell className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                                            <DropdownMenuItem onSelect={() => handleDelete(item.id)} className="text-destructive">Delete</DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                  </TableCell>
                                </TableRow>
                              )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                 </div>
              </AccordionItem>
            ))}
          </Accordion>
      )}
      </main>
  );
}
