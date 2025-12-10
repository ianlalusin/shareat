

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { PlusCircle, MoreHorizontal, Plus, Image as ImageIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useFirestore, useAuth, useStorage } from '@/firebase';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Switch } from '@/components/ui/switch';
import { Product } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { TagsInput } from '@/components/ui/tags-input';
import { formatCurrency, parseCurrency, UNIT_OPTIONS } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import Image from 'next/image';
import { BarcodeInput } from '@/components/ui/barcode-input';
import { ImageUpload } from '@/components/ui/image-upload';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

const initialItemState: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'lastUpdatedBy'> = {
  productName: '',
  category: '',
  barcode: '',
  unit: 'pc',
  specialTags: [],
  isActive: true,
  defaultCost: 0,
  defaultPrice: 0,
  imageUrl: '',
};

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'lastUpdatedBy'>>(initialItemState);
  const [displayValues, setDisplayValues] = useState<{ defaultCost: string; defaultPrice: string }>({ defaultCost: '', defaultPrice: '' });
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  const firestore = useFirestore();
  const auth = useAuth();
  const storage = useStorage();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();


  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'products'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Product[];
        setItems(itemsData);
      });
      return () => unsubscribe();
    }
  }, [firestore]);

  const handleModalOpenChange = (open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      setEditingItem(null);
      setFormData(initialItemState);
      setDisplayValues({ defaultCost: '', defaultPrice: '' });
      setImageFile(null);
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
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
  
  const handleFileChange = (file: File | null) => {
    setImageFile(file);
    if(file){
        setFormData(prev => ({ ...prev, imageUrl: URL.createObjectURL(file) }));
    }
  };

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, isActive: checked }));
  };
  
  const handleTagsChange = (newTags: string[]) => {
    setFormData(prev => ({...prev, specialTags: newTags}));
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage) return;

    const user = auth?.currentUser;

    let imageUrl = formData.imageUrl || '';
    if (imageFile) {
        try {
            const imageRef = ref(storage, `Shareat Hub/products/${Date.now()}_${imageFile.name}`);
            const snapshot = await uploadBytes(imageRef, imageFile);
            imageUrl = await getDownloadURL(snapshot.ref);
        } catch (error) {
           console.error("Save error:", error);
           toast({
            variant: "destructive",
            title: "Image upload failed.",
            description: "Could not upload the product image. Please try again.",
          });
        }
    }

    const finalFormData = { ...formData, imageUrl };
    if (!finalFormData.barcode) {
      finalFormData.barcode = String(Date.now());
    }

    const dataToSave = {
      ...finalFormData,
      updatedAt: serverTimestamp(),
      lastUpdatedBy: user?.displayName || user?.email || 'Unknown User',
    };

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'products', editingItem.id);
        await updateDoc(itemRef, dataToSave);
      } else {
        const productsRef = collection(firestore, 'products');
        const q = query(productsRef, where('barcode', '==', finalFormData.barcode));
        const existing = await getDocs(q);

        if (!existing.empty) {
          toast({
            variant: 'destructive',
            title: 'Duplicate barcode',
            description: 'A product with this barcode already exists.',
          });
          return;
        }

        await addDoc(productsRef, {
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
        description: "There was a problem saving the product.",
      });
    }
  };
  
  const handleEdit = (item: Product) => {
    setEditingItem(item);
    setFormData({
        ...initialItemState,
        ...item,
        specialTags: item.specialTags || [],
    });
    setDisplayValues({
      defaultCost: formatCurrency(item.defaultCost),
      defaultPrice: formatCurrency(item.defaultPrice),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'products', itemId));
      toast({
        title: "Success!",
        description: "The product has been deleted.",
      });
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "Could not delete the product. Please try again.",
      });
    }
  };

  const openAddModal = (category?: string) => {
    setEditingItem(null);
    const newFormData = category ? {...initialItemState, category} : initialItemState;
    setFormData(newFormData);
    setDisplayValues({ defaultCost: '', defaultPrice: '' });
    setImageFile(null);
    setIsModalOpen(true);
  }

  const groupedItems = useMemo(() => {
    const grouped = items.reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {} as Record<string, Product[]>);
    
    return Object.keys(grouped).sort().reduce(
      (obj, key) => { 
        obj[key] = grouped[key].sort((a, b) => a.productName.localeCompare(b.productName)); 
        return obj;
      }, 
      {} as Record<string, Product[]>
    );
  }, [items]);
  

  return (
      <main className="flex flex-1 flex-col gap-2 p-2 lg:gap-3 lg:p-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Product Manager
        </h1>
        <div className="flex items-center gap-2">
          <Dialog open={isModalOpen} onOpenChange={handleModalOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2" onClick={() => openAddModal()}>
                <PlusCircle className="h-4 w-4" />
                <span>Add Product</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>{editingItem ? 'Edit Product' : 'Add New Product'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="productName">Product Name</Label>
                      <Input id="productName" name="productName" value={formData.productName} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required />
                    </div>
                  </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="barcode">Barcode/SKU</Label>
                      <BarcodeInput id="barcode" name="barcode" value={formData.barcode} onChange={handleInputChange} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="unit">Unit</Label>
                        <Select name="unit" value={formData.unit} onValueChange={(value) => handleSelectChange('unit', value)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select unit"/>
                            </SelectTrigger>
                            <SelectContent>
                                {UNIT_OPTIONS.map(opt => (
                                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="defaultCost">Default Cost</Label>
                      <Input id="defaultCost" name="defaultCost" type="text" inputMode="decimal" value={displayValues.defaultCost} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                    </div>
                     <div className="space-y-2">
                      <Label htmlFor="defaultPrice">Default Price</Label>
                      <Input id="defaultPrice" name="defaultPrice" type="text" inputMode="decimal" value={displayValues.defaultPrice} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                    <div className="space-y-2">
                        <Label>Product Image</Label>
                        <ImageUpload
                            imageUrl={formData.imageUrl}
                            onFileChange={handleFileChange}
                        />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="specialTags">Special Tags</Label>
                        <TagsInput
                            id="specialTags"
                            name="specialTags"
                            value={formData.specialTags}
                            onChange={handleTagsChange}
                            placeholder="Add tags..."
                        />
                     </div>
                     <div className="flex items-center space-x-2 self-end pb-2">
                        <Switch id="isActive" name="isActive" checked={formData.isActive} onCheckedChange={handleSwitchChange} />
                        <Label htmlFor="isActive">Active</Label>
                    </div>
                  </div>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => handleModalOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingItem ? 'Save Changes' : 'Save Product'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
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
                    openAddModal(category);
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
                          <TableHead className="px-2 h-10">Product Name</TableHead>
                          <TableHead className="px-2 h-10">Barcode/SKU</TableHead>
                          <TableHead className="px-2 h-10">Unit</TableHead>
                          <TableHead className="px-2 h-10 text-right">Cost</TableHead>
                          <TableHead className="px-2 h-10 text-right">Price</TableHead>
                          <TableHead className="px-2 h-10">Tags</TableHead>
                          <TableHead className="px-2 h-10">Status</TableHead>
                          <TableHead className="px-2 h-10">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itemsInCategory.map((item) => (
                          <TableRow key={item.id} onClick={() => handleEdit(item)} className="cursor-pointer">
                            <TableCell className="p-2">
                              <div className="h-10 w-10 flex items-center justify-center rounded-md bg-muted overflow-hidden">
                                  {item.imageUrl ? (
                                      <Image src={item.imageUrl} alt={item.productName} width={40} height={40} className="object-cover h-full w-full" />
                                  ) : (
                                      <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                  )}
                              </div>
                            </TableCell>
                            <TableCell className="p-2 font-medium">{item.productName}</TableCell>
                            <TableCell className="p-2">{item.barcode}</TableCell>
                            <TableCell className="p-2">{item.unit}</TableCell>
                            <TableCell className="p-2 text-right">{formatCurrency(item.defaultCost)}</TableCell>
                            <TableCell className="p-2 text-right">{formatCurrency(item.defaultPrice)}</TableCell>
                            <TableCell className="p-2">
                              <div className="flex flex-wrap gap-1">
                                {item.specialTags?.map(tag => (
                                  <Badge key={tag} variant="outline">{tag}</Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="p-2">
                              <Badge
                                variant={item.isActive ? 'default' : 'destructive'}
                                className={item.isActive ? 'bg-green-500' : ''}
                              >
                                {item.isActive ? 'Active' : 'Inactive'}
                              </Badge>
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
                                  <DropdownMenuItem onSelect={() => handleDelete(item.id)} className="text-destructive">Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </AccordionContent>
             </div>
          </AccordionItem>
        ))}
      </Accordion>
      
      </main>
  );
}

