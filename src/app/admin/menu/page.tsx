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
  writeBatch,
  getDocs,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
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
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialItemState: Omit<MenuItem, 'id'> = {
  menuName: '',
  category: '',
  soldBy: 'unit',
  cost: 0,
  price: 0,
  barcode: '',
  isAvailable: true,
  storeIds: [],
  availability: 'always',
  imageUrl: '',
  publicDescription: '',
  targetStation: undefined,
  taxRate: '',
  trackInventory: false,
  alertLevel: 0,
  specialTags: [],
  parentMenuId: undefined,
  variantName: undefined,
};

type VariantFormData = Partial<Omit<MenuItem, 'id' | 'parentMenuId'>> & {
  variantName: string;
};

const initialVariantFormState: VariantFormData = {
  variantName: '',
  cost: 0,
  price: 0,
  barcode: '',
  isAvailable: true,
  publicDescription: '',
  specialTags: [],
  imageUrl: '',
};

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [availabilityOptions, setAvailabilityOptions] = useState<GListItem[]>([]);
  const [taxRates, setTaxRates] = useState<GListItem[]>([]);
  const [specialTags, setSpecialTags] = useState<GListItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [formData, setFormData] = useState<Omit<MenuItem, 'id'>>(initialItemState);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [variantImageFile, setVariantImageFile] = useState<File | null>(null);

  const [isAddingVariant, setIsAddingVariant] = useState(false);
  const [variantFormData, setVariantFormData] = useState<VariantFormData>(initialVariantFormState);
  
  const [displayValues, setDisplayValues] = useState<{ cost: string, price: string, variantCost: string, variantPrice: string }>({ cost: '', price: '', variantCost: '', variantPrice: '' });
  
  const firestore = useFirestore();
  const storage = useStorage();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore) {
      const menuUnsubscribe = onSnapshot(collection(firestore, 'menu'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MenuItem[];
        setItems(itemsData);
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
        const availabilityData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
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

      const specialTagsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'special tags'),
        where('is_active', '==', true)
      );
      const specialTagsUnsubscribe = onSnapshot(specialTagsQuery, (snapshot) => {
        const tagsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setSpecialTags(tagsData);
      });
      
      return () => {
        availabilityUnsubscribe();
        taxRateUnsubscribe();
        specialTagsUnsubscribe();
      };
    }
  }, [firestore, selectedStoreId]);


  useEffect(() => {
    if (editingItem) {
      setFormData({
        ...initialItemState,
        ...editingItem,
        specialTags: editingItem.specialTags || [],
      });
       setDisplayValues({
         cost: formatCurrency(editingItem.cost),
         price: formatCurrency(editingItem.price),
         variantCost: '',
         variantPrice: '',
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
      setVariantFormData(initialVariantFormState);
      setVariantImageFile(null);
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

  const handleVariantInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setVariantFormData(prev => ({...prev, [name]: value}));
  }
  
  const handleCurrencyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numericValue = value.replace(/[^0-9.]/g, '');
    
    if (name === 'variantCost' || name === 'variantPrice') {
       setDisplayValues(prev => ({ ...prev, [name]: numericValue }));
       setVariantFormData(prev => ({ ...prev, [name.replace('variant','').toLowerCase()]: parseCurrency(numericValue) }));
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
        const fieldName = name.replace('variant','').toLowerCase() as 'cost' | 'price';
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

  const handleVariantFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVariantImageFile(e.target.files[0]);
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

  const handleVariantSwitchChange = (name: string, checked: boolean) => {
    setVariantFormData(prev => ({ ...prev, [name]: checked }));
  }

  const handleSpecialTagChange = (tag: string) => {
    setFormData(prev => {
      const currentTags = prev.specialTags || [];
      const newTags = currentTags.includes(tag)
        ? currentTags.filter(t => t !== tag)
        : [...currentTags, tag];
      return { ...prev, specialTags: newTags };
    });
  };

  const handleVariantSpecialTagChange = (tag: string) => {
    setVariantFormData(prev => {
      const currentTags = prev.specialTags || [];
      const newTags = currentTags.includes(tag)
        ? currentTags.filter(t => t !== tag)
        : [...currentTags, tag];
      return { ...prev, specialTags: newTags };
    });
  };


  const handleAddVariant = async () => {
    if (!firestore || !storage || !editingItem || !variantFormData.variantName) return;
    
    let variantImageUrl = variantFormData.imageUrl || editingItem.imageUrl || '';
    if (variantImageFile) {
      const imageRef = ref(storage, `Shareat Hub/menu_items/${Date.now()}_${variantImageFile.name}`);
      const snapshot = await uploadBytes(imageRef, variantImageFile);
      variantImageUrl = await getDownloadURL(snapshot.ref);
    }

    const newVariant: Omit<MenuItem, 'id'> = {
      // Inherited properties
      menuName: editingItem.menuName,
      category: editingItem.category,
      storeIds: editingItem.storeIds,
      availability: editingItem.availability,
      targetStation: editingItem.targetStation,
      taxRate: editingItem.taxRate,
      soldBy: editingItem.soldBy,
      
      // Variant-specific properties from the form
      parentMenuId: editingItem.id,
      variantName: variantFormData.variantName,
      cost: variantFormData.cost ?? 0,
      price: variantFormData.price ?? 0,
      barcode: variantFormData.barcode ?? '',
      isAvailable: variantFormData.isAvailable ?? true,
      publicDescription: variantFormData.publicDescription ?? editingItem.publicDescription,
      specialTags: variantFormData.specialTags ?? editingItem.specialTags,
      imageUrl: variantImageUrl,
      trackInventory: variantFormData.trackInventory ?? false,
      alertLevel: variantFormData.alertLevel ?? 0,
    };

    try {
      await addDoc(collection(firestore, 'menu'), newVariant);
      handleCancelVariant();
    } catch (error) {
      console.error("Error adding variant: ", error);
    }
  };

  const handleAddNewVariantClick = () => {
    setVariantFormData(initialVariantFormState);
    setDisplayValues(prev => ({...prev, variantCost: formatCurrency(0), variantPrice: formatCurrency(0)}));
    setVariantImageFile(null);
    setIsAddingVariant(true);
  }

  const handleCancelVariant = () => {
    setVariantFormData(initialVariantFormState);
    setDisplayValues(prev => ({...prev, variantCost: '', variantPrice: ''}));
    setVariantImageFile(null);
    setIsAddingVariant(false);
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
    
    const dataToSave: Omit<MenuItem, 'id'> = { ...formData, imageUrl, specialTags: formData.specialTags || [] };

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'menu', editingItem.id);
        // @ts-ignore
        await updateDoc(itemRef, dataToSave);

        // If it's a main item, update its variants' shared properties
        if (!editingItem.parentMenuId) {
          const batch = writeBatch(firestore);
          const q = query(collection(firestore, "menu"), where("parentMenuId", "==", editingItem.id));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((variantDoc) => {
            const variantRef = doc(firestore, 'menu', variantDoc.id);
            batch.update(variantRef, {
              menuName: dataToSave.menuName,
              category: dataToSave.category,
              storeIds: dataToSave.storeIds,
              availability: dataToSave.availability,
              targetStation: dataToSave.targetStation,
              taxRate: dataToSave.taxRate,
              soldBy: dataToSave.soldBy,
            });
          });
          await batch.commit();
        }

      } else {
        // @ts-ignore
        await addDoc(collection(firestore, 'menu'), dataToSave);
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error("Error saving document: ", error);
    }
  };
  
  const handleEdit = (item: MenuItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (event: React.MouseEvent, itemToDelete: MenuItem) => {
    event.stopPropagation();
    if (!firestore) return;
    if (window.confirm(`Are you sure you want to delete this item? ${!itemToDelete.parentMenuId ? 'This will also delete all its variants.' : ''}`)) {
      try {
        const batch = writeBatch(firestore);

        // Delete the item itself
        const itemRef = doc(firestore, 'menu', itemToDelete.id);
        batch.delete(itemRef);

        // If it's a main item, find and delete all its variants
        if (!itemToDelete.parentMenuId) {
          const q = query(collection(firestore, "menu"), where("parentMenuId", "==", itemToDelete.id));
          const querySnapshot = await getDocs(q);
          querySnapshot.forEach((variantDoc) => {
            batch.delete(variantDoc.ref);
          });
        }
        
        await batch.commit();

      } catch (error) {
        console.error("Error deleting document(s): ", error);
      }
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
    setEditingItem(null);
    setFormData(initialItemState);
    setIsModalOpen(true);
  }
  
  const getSelectedStoreNames = () => {
    if (formData.storeIds.length === 0) return "Select stores";
    if (formData.storeIds.length === stores.length) return "All stores selected";
    if (formData.storeIds.length > 2) return `${formData.storeIds.length} stores selected`;
    return stores
        .filter(s => formData.storeIds.includes(s.id))
        .map(s => s.storeName)
        .join(', ');
  };

  const getSelectedTagNames = (tags: string[] | undefined) => {
    const selectedCount = tags?.length || 0;
    if (selectedCount === 0) return "Select special tags";
    if (specialTags.length > 0 && selectedCount === specialTags.length) return "All tags selected";
    if (selectedCount > 2) return `${selectedCount} tags selected`;
    return specialTags
        .filter(t => tags?.includes(t.item))
        .map(t => t.item)
        .join(', ');
  };

  const calculateProfit = (cost: number, price: number) => {
    if (price <= cost || price <= 0) return '0.00%';
    const profit = ((price - cost) / price) * 100;
    return `${profit.toFixed(2)}%`;
  }

  const groupedItems = useMemo(() => {
    const mainItems = items.filter(item => !item.parentMenuId);
    const variants = items.filter(item => item.parentMenuId);

    const grouped = mainItems.reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        ...item,
        // @ts-ignore
        variants: variants.filter(v => v.parentMenuId === item.id).sort((a, b) => (a.variantName || '').localeCompare(b.variantName || '')),
      });
      return acc;
    }, {} as Record<string, (MenuItem & { variants: MenuItem[] })[]>);
    
    // sort categories alphabetically
    return Object.keys(grouped).sort().reduce(
      (obj, key) => { 
        // @ts-ignore
        obj[key] = grouped[key].sort((a, b) => a.menuName.localeCompare(b.menuName)); 
        return obj;
      }, 
      {} as Record<string, (MenuItem & { variants: MenuItem[] })[]>
    );
  }, [items]);
  
  const isVariant = !!formData.parentMenuId;

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
                  ? `Edit ${isVariant ? `${editingItem.menuName} (${editingItem.variantName})` : editingItem.menuName}`
                  : 'Add New Menu Item'}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="space-y-4 py-4">
                {/* --- Main Item Fields --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="menuName">Menu Name</Label>
                        <Input id="menuName" name="menuName" value={formData.menuName} onChange={handleInputChange} required disabled={isVariant} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required disabled={isVariant} />
                    </div>
                </div>

                {/* --- Variant Name Field (for variants only) --- */}
                {isVariant && (
                  <div className="space-y-2">
                    <Label htmlFor="variantName">Variant Name</Label>
                    <Input id="variantName" name="variantName" value={formData.variantName || ''} onChange={handleInputChange} required />
                  </div>
                )}
                
                {/* --- Variants Section (for main items only) --- */}
                {!isVariant && editingItem && (
                  <div className="space-y-2">
                    <Label>Variants</Label>
                    <div className="space-y-2 rounded-md border p-2">
                       {items.filter(i => i.parentMenuId === editingItem.id).map(variant => (
                          <div key={variant.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                              <span className="flex-1 font-medium">{variant.variantName}</span>
                              <span className="text-sm text-muted-foreground">{formatCurrency(variant.price)}</span>
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleEdit(variant)}><Pencil className="h-4 w-4"/></Button>
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={(e) => handleDelete(e, variant)}><Trash2 className="h-4 w-4"/></Button>
                          </div>
                      ))}

                      {isAddingVariant && (
                         <div className="p-4 border-t mt-4 space-y-4">
                              <div className='flex justify-between items-center'>
                                  <h4 className="font-medium">Add New Variant</h4>
                                  <div className="flex justify-end gap-2">
                                      <Button type="button" variant="ghost" onClick={handleCancelVariant}>Cancel</Button>
                                      <Button type="button" onClick={handleAddVariant}>Add Variant</Button>
                                  </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-start">
                                  <div className="space-y-2">
                                      <Label htmlFor="variantNameInput">Variant Name</Label>
                                      <Input id="variantNameInput" name="variantName" value={variantFormData.variantName} onChange={handleVariantInputChange} required/>
                                  </div>
                                  <div className="space-y-2">
                                      <Label htmlFor="variantCost">Cost</Label>
                                      <Input id="variantCost" name="variantCost" value={displayValues.variantCost} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                                  </div>
                                  <div className="space-y-2">
                                      <Label htmlFor="variantPrice">Price</Label>
                                      <Input id="variantPrice" name="variantPrice" value={displayValues.variantPrice} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} />
                                  </div>
                                  <div className="space-y-2">
                                      <Label htmlFor="variantBarcode">Barcode</Label>
                                      <Input id="variantBarcode" name="barcode" value={variantFormData.barcode ?? ''} onChange={handleVariantInputChange} />
                                  </div>
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="variantDescription">Description</Label>
                                <Textarea id="variantDescription" name="publicDescription" value={variantFormData.publicDescription} onChange={handleVariantInputChange} />
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label>Special Tags</Label>
                                  <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                      <Button variant="outline" className="w-full justify-between font-normal">
                                          <span>{getSelectedTagNames(variantFormData.specialTags)}</span>
                                          <ChevronDown className="h-4 w-4" />
                                      </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                                        {specialTags.map(tag => (
                                              <DropdownMenuCheckboxItem
                                                  key={tag.id}
                                                  checked={variantFormData.specialTags?.includes(tag.item)}
                                                  onSelect={(e) => e.preventDefault()}
                                                  onClick={() => handleVariantSpecialTagChange(tag.item)}
                                              >
                                                  {tag.item}
                                              </DropdownMenuCheckboxItem>
                                          ))}
                                          {specialTags.length === 0 && <DropdownMenuItem disabled>No special tags found</DropdownMenuItem>}
                                      </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="variantImage">Image</Label>
                                    <Input id="variantImage" name="imageUrl" type="file" onChange={handleVariantFileChange} />
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Label htmlFor="variantIsAvailable">Available</Label>
                                <Switch id="variantIsAvailable" name="isAvailable" checked={variantFormData.isAvailable} onCheckedChange={(c) => handleVariantSwitchChange('isAvailable', c)} />
                              </div>
                         </div>
                      )}
                      {!isAddingVariant && (
                          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={handleAddNewVariantClick}>
                              <Plus className="mr-2 h-4 w-4" /> Add Variant
                          </Button>
                      )}
                    </div>
                  </div>
                )}
                
                {/* --- Individual Pricing & Barcode --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="cost">Cost</Label>
                    <Input id="cost" name="cost" type="text" inputMode="decimal" value={displayValues.cost} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="price">Price</Label>
                    <Input id="price" name="price" type="text" inputMode="decimal" value={displayValues.price} onChange={handleCurrencyInputChange} onBlur={handleCurrencyInputBlur} onFocus={handleCurrencyInputFocus} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="barcode">Barcode</Label>
                    <Input id="barcode" name="barcode" value={formData.barcode} onChange={handleInputChange} />
                  </div>
                </div>

                {/* --- Common Fields --- */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="soldBy">Sold By</Label>
                    <Select name="soldBy" value={formData.soldBy} onValueChange={(value) => handleSelectChange('soldBy', value)} required disabled={isVariant}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unit">Unit</SelectItem>
                        <SelectItem value="fraction">Fraction</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="availability">Availability</Label>
                    <Select name="availability" value={formData.availability} onValueChange={(value) => handleSelectChange('availability', value)} disabled={isVariant}>
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
                    <Select name="targetStation" value={formData.targetStation} onValueChange={(value) => handleSelectChange('targetStation', value)} disabled={isVariant}>
                      <SelectTrigger><SelectValue placeholder="Select station"/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Hot">Hot</SelectItem>
                        <SelectItem value="Cold">Cold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="taxRate">Tax Rate</Label>
                    <Select name="taxRate" value={formData.taxRate} onValueChange={(value) => handleSelectChange('taxRate', value)} disabled={isVariant}>
                      <SelectTrigger><SelectValue placeholder="Select tax rate"/></SelectTrigger>
                      <SelectContent>
                        {taxRates.length > 0 ? taxRates.map(rate => (
                            <SelectItem key={rate.id} value={rate.item}>{rate.item}</SelectItem>
                        )) : <SelectItem value="no-rates" disabled>No tax rates for this store</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="storeIds">Applicable Stores</Label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between" disabled={isVariant}>
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
                </div>
                <div className="space-y-2">
                    <Label>Special Tags</Label>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="w-full justify-between font-normal" disabled={isVariant}>
                            <span>{getSelectedTagNames(formData.specialTags)}</span>
                            <ChevronDown className="h-4 w-4" />
                        </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                           {specialTags.map(tag => (
                                <DropdownMenuCheckboxItem
                                    key={tag.id}
                                    checked={formData.specialTags?.includes(tag.item)}
                                    onSelect={(e) => e.preventDefault()}
                                    onClick={() => handleSpecialTagChange(tag.item)}
                                >
                                    {tag.item}
                                </DropdownMenuCheckboxItem>
                            ))}
                            {specialTags.length === 0 && <DropdownMenuItem disabled>No special tags found</DropdownMenuItem>}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                      <Label htmlFor="imageUrl">Image</Label>
                      <Input id="imageUrl" name="imageUrl" type="file" onChange={handleFileChange} disabled={isVariant} />
                  </div>
                    <div className="space-y-2">
                        <Label htmlFor="publicDescription">Public Description</Label>
                        <Textarea id="publicDescription" name="publicDescription" value={formData.publicDescription} onChange={handleInputChange} disabled={isVariant}/>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <div className="flex items-center gap-4">
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
                            <Alert>
                                <AlertDescription>
                                    Low stock alerts will be triggered when the quantity in stock reaches the alert level.
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                     <div className="flex items-center space-x-2">
                        <Label htmlFor="isAvailable">Available</Label>
                        <Switch id="isAvailable" name="isAvailable" checked={formData.isAvailable} onCheckedChange={(c) => handleSwitchChange('isAvailable', c)} />
                    </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={isAddingVariant}>{editingItem ? 'Save Changes' : 'Save'}</Button>
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
                      {/* @ts-ignore */}
                      <Badge variant="secondary">{itemsInCategory.length}</Badge>
                  </div>
                </AccordionTrigger>
                 <Button
                  size="sm"
                  variant="ghost"
                  className="mr-2 h-7 w-7 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingItem(null);
                    setFormData({...initialItemState, category});
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
                        <TableHead className="px-2 h-10 text-xs">Sold By</TableHead>
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
                      {itemsInCategory.flatMap((item) => {
                        const mainRow = (
                          // @ts-ignore
                          <TableRow key={item.id} onClick={() => handleEdit(item)} className="cursor-pointer font-medium bg-muted/20">
                            <TableCell className="p-2 text-xs">{item.menuName}</TableCell>
                            <TableCell className="p-2 text-xs">
                              <Badge variant="outline" className="mr-1 mb-1 whitespace-nowrap">
                                {(item.availability || 'Always').substring(0, 6)}{(item.availability && item.availability.length > 6) ? '...' : ''}
                              </Badge>
                            </TableCell>
                            <TableCell className="p-2 capitalize text-xs">{item.targetStation}</TableCell>
                            <TableCell className="p-2 capitalize text-xs">{item.soldBy}</TableCell>
                            {/* @ts-ignore */}
                            <TableCell className="p-2 text-right text-xs">{!item.variants.length ? formatCurrency(item.cost) : ''}</TableCell>
                            {/* @ts-ignore */}
                            <TableCell className="p-2 text-right text-xs">{!item.variants.length ? formatCurrency(item.price) : ''}</TableCell>
                             {/* @ts-ignore */}
                            <TableCell className="p-2 text-right text-xs">{!item.variants.length ? calculateProfit(item.cost, item.price) : ''}</TableCell>
                             {/* @ts-ignore */}
                            <TableCell className="p-2 text-xs">{!item.variants.length ? item.barcode : ''}</TableCell>
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
                                  <DropdownMenuItem onSelect={(e) => handleDelete(e as unknown as React.MouseEvent, item)}>Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );

                        {/* @ts-ignore */}
                        const variantRows = item.variants.map((variant) => (
                           <TableRow key={variant.id} onClick={() => handleEdit(variant)} className="cursor-pointer hover:bg-muted/40">
                             <TableCell className="p-2 text-xs pl-6 text-muted-foreground">{variant.variantName}</TableCell>
                             <TableCell className="p-2 text-xs"></TableCell>
                             <TableCell className="p-2 capitalize text-xs"></TableCell>
                             <TableCell className="p-2 capitalize text-xs"></TableCell>
                             <TableCell className="p-2 text-right text-xs text-muted-foreground">{formatCurrency(variant.cost)}</TableCell>
                             <TableCell className="p-2 text-right text-xs text-muted-foreground">{formatCurrency(variant.price)}</TableCell>
                             <TableCell className="p-2 text-right text-xs text-muted-foreground">{calculateProfit(variant.cost, variant.price)}</TableCell>
                             <TableCell className="p-2 text-xs text-muted-foreground">{variant.barcode}</TableCell>
                             <TableCell className="p-2 text-xs" onClick={(e) => e.stopPropagation()}>
                                <div className="flex flex-col items-center gap-1">
                                    <Switch
                                      checked={variant.isAvailable}
                                      onCheckedChange={(newStatus) => handleAvailabilityChange(variant.id, newStatus)}
                                      aria-label={`Toggle ${variant.variantName} availability`}
                                    />
                                    <span className="text-xs text-muted-foreground">{variant.isAvailable ? 'Available' : 'Unavailable'}</span>
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
                                      <DropdownMenuItem onSelect={() => handleEdit(variant)}>Edit</DropdownMenuItem>
                                      <DropdownMenuItem onSelect={(e) => handleDelete(e as unknown as React.MouseEvent, variant)}>Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                             </TableCell>
                           </TableRow>
                        ));

                        return [mainRow, ...variantRows];
                      })}
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
