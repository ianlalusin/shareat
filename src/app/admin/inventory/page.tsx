

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
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  const [formData, setFormData] = useState<FormData>(initialItemState);
  const [displayValues, setDisplayValues] = useState<{ costPerUnit: string }>({ costPerUnit: ''});
  const [dateError, setDateError] = useState<string | undefined>();
  
  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

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
        }));
        setDisplayValues({
            costPerUnit: formatCurrency(selectedProduct.defaultCost || 0),
        });
    }
  }, [selectedProduct, editingItem]);
  
  const handleModalOpenChange = (open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      setEditingItem(null);
      setFormData(initialItemState);
      setDisplayValues({ costPerUnit: '' });
      setDateError(undefined);
    }
  }

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
        toast({
            variant: 'destructive',
            title: 'Invalid Date',
            description: 'Please fix the date format before saving.',
        });
        return;
    }

    const { expiryDate, ...restOfData } = formData;
    
    const numericData = {
      ...restOfData,
      currentQty: parseFloat(restOfData.currentQty as any) || 0,
      reorderPoint: parseFloat(restOfData.reorderPoint as any) || 0,
      criticalPoint: parseFloat(restOfData.criticalPoint as any) || 0,
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
      handleModalOpenChange(false);
      openSuccessModal();
    } catch (error) {
       console.error("Save error:", error);
       toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "There was a problem saving the item.",
      });
    }
  };
  
  const handleEdit = (item: InventoryItem) => {
    let expiryDateStr = '';
    if (item.expiryDate) {
        try {
            expiryDateStr = formatAndValidateDate(item.expiryDate.toDate().toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })).formatted;
        } catch (e) {
            // handle cases where expiryDate is not a valid Timestamp
        }
    }
    
    const product = products.find(p => p.id === item.productId);

    setFormData({
        ...initialItemState,
        ...item,
        name: product?.productName ?? item.name,
        category: product?.category ?? item.category,
        sku: product?.barcode ?? item.sku,
        unit: product?.unit ?? item.unit,
        expiryDate: expiryDateStr,
    });
    setDisplayValues({
        costPerUnit: formatCurrency(item.costPerUnit),
    });

    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    console.log("Deleting item:", itemId); // DEBUG
    try {
        await deleteDoc(doc(firestore, 'inventory', itemId));
        openSuccessModal();
    } catch (error) {
        console.error("Delete error:", error);
        toast({
            variant: "destructive",
            title: "Uh oh! Something went wrong.",
            description: "Could not delete the item.",
        });
    }
  };
  
  const handleOpenAddModal = (category?: string) => {
    setEditingItem(null);
    const newFormState = category ? {...initialItemState, category} : initialItemState;
    setFormData(newFormState);
    setDisplayValues({ costPerUnit: '' });
    setDateError(undefined);
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
        <Dialog open={isModalOpen} onOpenChange={handleModalOpenChange}>
            <DialogTrigger asChild>
                <Button size="sm" className="flex items-center gap-2" onClick={() => handleOpenAddModal()} disabled={!selectedStoreId}>
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
                    {formData.trackInventory && (
                        <div className="space-y-2">
                            <Label htmlFor="currentQty">Current Quantity</Label>
                            <Input id="currentQty" name="currentQty" type="number" value={formData.currentQty} onChange={handleInputChange} required/>
                        </div>
                    )}
                    {/* Row 3 */}
                    {formData.trackInventory && (
                      <>
                        <div className="space-y-2">
                            <Label htmlFor="reorderPoint">Re-order Point</Label>
                            <Input id="reorderPoint" name="reorderPoint" type="number" value={formData.reorderPoint} onChange={handleInputChange} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="criticalPoint">Critical Point</Label>
                            <Input id="criticalPoint" name="criticalPoint" type="number" value={formData.criticalPoint} onChange={handleInputChange} />
                        </div>
                      </>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="costPerUnit">Cost per Unit</Label>
                        <Input id="costPerUnit" name="costPerUnit" type="text" inputMode='decimal' value={displayValues.costPerUnit} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required/>
                    </div>
                     {/* Row 4 */}
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
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => handleModalOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingItem ? 'Save Changes' : 'Save Item'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
        </Dialog>
      </div>

       {!selectedStoreId ? (
          <Alert variant="info" size="sm">
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
                            handleOpenAddModal(category);
                        }}
                        >
                        <Plus className="h-4 w-4" />
                    </Button>
                   </div>
                  <AccordionContent className="p-0">
                    <ScrollArea className="w-full max-w-full">
                      <div className="border-t">
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
                                    <TableCell className="p-2 font-medium">{product?.productName ?? item.name}</TableCell>
                                    <TableCell className="p-2 text-muted-foreground">{product?.barcode ?? item.sku}</TableCell>
                                    <TableCell className="p-2"><Badge variant="outline">{item.itemType}</Badge></TableCell>
                                    <TableCell className="p-2 text-right font-bold text-lg">{item.currentQty}</TableCell>
                                    <TableCell className="p-2">{product?.unit ?? item.unit}</TableCell>
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
                                              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleDelete(item.id); }} className="text-destructive">Delete</DropdownMenuItem>
                                          </DropdownMenuContent>
                                      </DropdownMenu>
                                    </TableCell>
                                  </TableRow>
                                )
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                 </div>
              </AccordionItem>
            ))}
          </Accordion>
      )}
      </main>
  );
}

    