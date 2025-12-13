
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { PlusCircle, ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useFirestore } from '@/firebase';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  query,
} from 'firebase/firestore';
import { Switch } from '@/components/ui/switch';
import { CollectionItem, Store, Schedule, TaxRate, DiscountType } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';

const initialItemState: Omit<CollectionItem, 'id'> = {
  item: '',
  category: '',
  subCategory: '',
  is_active: true,
  storeIds: [],
};

const initialScheduleState: Omit<Schedule, 'id'> = {
    item: '',
    category: 'menu schedules',
    is_active: true,
    startTime: '',
    endTime: '',
    days: [],
};

const initialTaxRateState: Omit<TaxRate, 'id'> = {
    item: '',
    category: 'tax profile',
    code: '',
    rate: 0,
    isInclusive: false,
    is_active: true,
    storeIds: [],
}

const initialDiscountTypeState: Omit<DiscountType, 'id'> = {
    item: '',
    category: 'discount type',
    code: '',
    discountMode: 'PCT',
    discountValue: 0,
    appliesTo: 'bill',
    requiresTin: false,
    requiresName: false,
    is_active: true,
    storeIds: [],
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CollectionsPage() {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [discountTypes, setDiscountTypes] = useState<DiscountType[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CollectionItem | null>(null);
  const [itemFormData, setItemFormData] = useState<Omit<CollectionItem, 'id'>>(initialItemState);
  
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleFormData, setScheduleFormData] = useState(initialScheduleState);

  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [editingTaxRate, setEditingTaxRate] = useState<TaxRate | null>(null);
  const [taxFormData, setTaxFormData] = useState(initialTaxRateState);

  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [editingDiscountType, setEditingDiscountType] = useState<DiscountType | null>(null);
  const [discountFormData, setDiscountFormData] = useState(initialDiscountTypeState);
  
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetType, setDeleteTargetType] = useState<'item' | 'schedule' | 'tax' | 'discount' | null>(null);

  const firestore = useFirestore();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    const q = query(collection(firestore, 'lists'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const regularItems = allItems.filter(item => item.category !== 'menu schedules' && item.category !== 'tax profile' && item.category !== 'discount type').map(item => ({ ...item, storeIds: item.storeIds || [] })) as CollectionItem[];
      const scheduleItems = allItems.filter(item => item.category === 'menu schedules').map(item => ({...item, days: item.days || []})) as Schedule[];
      const taxRateItems = allItems.filter(item => item.category === 'tax profile').map(item => ({...item, storeIds: item.storeIds || []})) as TaxRate[];
      const discountTypeItems = allItems.filter(item => item.category === 'discount type').map(item => ({...item, storeIds: item.storeIds || []})) as DiscountType[];

      setItems(regularItems);
      setSchedules(scheduleItems);
      setTaxRates(taxRateItems);
      setDiscountTypes(discountTypeItems);
    });

    const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
      const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
      setStores(storesData);
    });

    return () => {
      unsubscribe();
      storesUnsubscribe();
    };
  }, [firestore]);
  
  // Item Modal Handlers
  const handleItemModalOpenChange = (open: boolean) => {
    setIsItemModalOpen(open);
    if (!open) {
      setEditingItem(null);
      setItemFormData(initialItemState);
    }
  };
  
  const handleItemInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setItemFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleStoreIdChange = (storeId: string) => {
    setItemFormData((prev) => {
      const newStoreIds = prev.storeIds.includes(storeId)
        ? prev.storeIds.filter(id => id !== storeId)
        : [...prev.storeIds, storeId];
      return { ...prev, storeIds: newStoreIds };
    });
  };

  const handleItemSwitchChange = (checked: boolean) => {
    setItemFormData((prev) => ({ ...prev, is_active: checked }));
  }

  const handleItemSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;

    if (itemFormData.storeIds.length === 0) {
        toast({
            variant: 'destructive',
            title: 'No Store Selected',
            description: 'Please select at least one store.',
        });
        return;
    }
    
    const operation = editingItem
        ? updateDoc(doc(firestore, 'lists', editingItem.id), itemFormData)
        : addDoc(collection(firestore, 'lists'), itemFormData);
        
    operation.then(() => {
        handleItemModalOpenChange(false);
        openSuccessModal();
    }).catch(error => {
        console.error("Save error:", error);
        toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "There was a problem with your request." });
    });
  };
  
  const handleEditItem = (item: CollectionItem) => {
    setEditingItem(item);
    setItemFormData({
      item: item.item,
      category: item.category,
      subCategory: item.subCategory || '',
      is_active: item.is_active,
      storeIds: item.storeIds || [],
    });
    setIsItemModalOpen(true);
  };
  
  const handleDelete = async () => {
    if (!firestore || !deleteTargetId || !deleteTargetType) return;

    try {
        await deleteDoc(doc(firestore, 'lists', deleteTargetId));
        let description = 'The item has been deleted.';
        if (deleteTargetType === 'schedule') description = 'The schedule has been deleted.';
        else if (deleteTargetType === 'tax') description = 'The tax profile has been deleted.';
        else if (deleteTargetType === 'discount') description = 'The discount type has been deleted.';
        
        toast({
            title: 'Deleted',
            description: description,
        });
    } catch (error) {
        console.error('Delete error:', error);
        toast({
            variant: 'destructive',
            title: 'Delete failed',
            description: 'Could not delete. Please try again.',
        });
    } finally {
        setDeleteTargetId(null);
        setDeleteTargetType(null);
    }
  };

  const openAddItemModal = () => {
    setEditingItem(null);
    setItemFormData(initialItemState);
    setIsItemModalOpen(true);
  }
  
  const openAddItemModalForCategory = (category: string) => {
    setEditingItem(null);
    setItemFormData({...initialItemState, category});
    setIsItemModalOpen(true);
  };
  
  const getSelectedStoreNames = (formType: 'item' | 'tax' | 'discount' = 'item') => {
    let storeIds: string[] = [];
    if (formType === 'item') storeIds = itemFormData.storeIds;
    else if (formType === 'tax') storeIds = taxFormData.storeIds;
    else if (formType === 'discount') storeIds = discountFormData.storeIds;

    if (storeIds.length === 0) return "Select stores";
    if (storeIds.length === stores.length) return "All stores selected";
    if (storeIds.length > 2) return `${storeIds.length} stores selected`;
    return stores
        .filter(s => storeIds.includes(s.id))
        .map(s => s.storeName)
        .join(', ');
  };
  
  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) { acc[category] = []; }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, CollectionItem[]>);
  
  // Schedule Modal Handlers
  const handleScheduleModalOpenChange = (open: boolean) => {
    setIsScheduleModalOpen(open);
    if (!open) {
      setEditingSchedule(null);
      setScheduleFormData(initialScheduleState);
    }
  };

  const handleScheduleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setScheduleFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleDayChange = (day: string) => {
    setScheduleFormData(prev => {
        const newDays = prev.days.includes(day)
            ? prev.days.filter((d:string) => d !== day)
            : [...prev.days, day];
        return {...prev, days: newDays };
    });
  };

  const handleScheduleSwitchChange = (checked: boolean) => {
    setScheduleFormData(prev => ({ ...prev, is_active: checked }));
  };

  const handleScheduleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;
    
    const operation = editingSchedule
        ? updateDoc(doc(firestore, 'lists', editingSchedule.id), scheduleFormData)
        : addDoc(collection(firestore, 'lists'), scheduleFormData);

    operation.then(() => {
        handleScheduleModalOpenChange(false);
        openSuccessModal();
    }).catch((error) => {
       console.error("Save error:", error);
       toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "Could not save schedule." });
    });
  };

  const handleEditSchedule = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setScheduleFormData({
        item: schedule.item,
        category: schedule.category,
        is_active: schedule.is_active,
        startTime: schedule.startTime || '',
        endTime: schedule.endTime || '',
        days: schedule.days || [],
    });
    setIsScheduleModalOpen(true);
  };
  
  // Tax Modal Handlers
  const handleTaxModalOpenChange = (open: boolean) => {
    setIsTaxModalOpen(open);
    if (!open) {
      setEditingTaxRate(null);
      setTaxFormData(initialTaxRateState);
    }
  };

  const handleTaxInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    
    setTaxFormData(prev => {
      let newValue: any = value;
      if (name === 'rate') {
        newValue = type === 'number' ? (Number(value) / 100) : prev.rate;
      } else if (type === 'number') {
        newValue = Number(value);
      }
      return { ...prev, [name]: newValue };
    });
  };
  
  const handleTaxStoreIdChange = (storeId: string) => {
    setTaxFormData(prev => {
      const newStoreIds = prev.storeIds.includes(storeId)
        ? prev.storeIds.filter(id => id !== storeId)
        : [...prev.storeIds, storeId];
      return { ...prev, storeIds: newStoreIds };
    });
  };

  const handleTaxSwitchChange = (name: 'is_active' | 'isInclusive', checked: boolean) => {
    setTaxFormData(prev => ({ ...prev, [name]: checked }));
  };

  const handleTaxSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;

    if (taxFormData.storeIds.length === 0) {
      toast({ variant: 'destructive', title: 'No Store Selected', description: 'Please select at least one store.' });
      return;
    }

    const dataToSave = { ...taxFormData };
    
    const operation = editingTaxRate
      ? updateDoc(doc(firestore, 'lists', editingTaxRate.id), dataToSave)
      : addDoc(collection(firestore, 'lists'), dataToSave);

    operation.then(() => {
      handleTaxModalOpenChange(false);
      openSuccessModal();
    }).catch(error => {
      console.error("Save error:", error);
      toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "Could not save tax profile." });
    });
  };

  const handleEditTaxRate = (taxRate: TaxRate) => {
    setEditingTaxRate(taxRate);
    setTaxFormData({
      item: taxRate.item,
      category: 'tax profile',
      code: taxRate.code || '',
      rate: taxRate.rate || 0,
      isInclusive: taxRate.isInclusive || false,
      is_active: taxRate.is_active,
      storeIds: taxRate.storeIds || [],
    });
    setIsTaxModalOpen(true);
  };
  
  // Discount Modal Handlers
    const handleDiscountModalOpenChange = (open: boolean) => {
        setIsDiscountModalOpen(open);
        if (!open) {
            setEditingDiscountType(null);
            setDiscountFormData(initialDiscountTypeState);
        }
    };

    const handleDiscountInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        setDiscountFormData(prev => ({ ...prev, [name]: type === 'number' ? Number(value) : value }));
    };

    const handleDiscountSelectChange = (name: keyof Omit<DiscountType, 'id'>, value: string) => {
        setDiscountFormData(prev => ({ ...prev, [name]: value as any }));
    };

    const handleDiscountSwitchChange = (name: 'is_active' | 'requiresTin' | 'requiresName', checked: boolean) => {
        setDiscountFormData(prev => ({ ...prev, [name]: checked }));
    };
    
    const handleDiscountStoreIdChange = (storeId: string) => {
        setDiscountFormData(prev => {
            const newStoreIds = prev.storeIds.includes(storeId)
                ? prev.storeIds.filter(id => id !== storeId)
                : [...prev.storeIds, storeId];
            return { ...prev, storeIds: newStoreIds };
        });
    };

    const handleDiscountSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!firestore) return;

        if (discountFormData.storeIds.length === 0) {
            toast({ variant: 'destructive', title: 'No Store Selected', description: 'Please select at least one store.' });
            return;
        }

        const operation = editingDiscountType
            ? updateDoc(doc(firestore, 'lists', editingDiscountType.id), discountFormData)
            : addDoc(collection(firestore, 'lists'), discountFormData);

        operation.then(() => {
            handleDiscountModalOpenChange(false);
            openSuccessModal();
        }).catch(error => {
            console.error("Save error:", error);
            toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "Could not save discount type." });
        });
    };

    const handleEditDiscountType = (discountType: DiscountType) => {
        setEditingDiscountType(discountType);
        setDiscountFormData({
            item: discountType.item,
            category: 'discount type',
            code: discountType.code || '',
            discountMode: discountType.discountMode || 'PCT',
            discountValue: discountType.discountValue || 0,
            appliesTo: discountType.appliesTo || 'bill',
            requiresTin: discountType.requiresTin || false,
            requiresName: discountType.requiresName || false,
            is_active: discountType.is_active,
            storeIds: discountType.storeIds || [],
        });
        setIsDiscountModalOpen(true);
    };


  return (
      <main className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Collections
        </h1>
      </div>
      
      {/* Item Lists Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold font-headline">List Items</h2>
             <Button size="sm" className="flex items-center gap-2" onClick={openAddItemModal}>
                <PlusCircle className="h-4 w-4" />
                <span>Add List Item</span>
              </Button>
        </div>
        <Accordion type="multiple" className="w-full" defaultValue={Object.keys(groupedItems)}>
            {Object.keys(groupedItems).sort().map((category) => (
            <AccordionItem key={category} value={category} className="border-0 mb-3">
                <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
                <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                    <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                    <div className='flex items-center gap-2'>
                        <h2 className="text-base font-semibold">{category}</h2>
                        <Badge variant="secondary">{groupedItems[category].length}</Badge>
                    </div>
                    </AccordionTrigger>
                    <Button
                    size="sm"
                    variant="ghost"
                    className="mr-2 h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); openAddItemModalForCategory(category); }}
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
                                <TableHead>Item</TableHead>
                                <TableHead className="hidden sm:table-cell">Sub-category</TableHead>
                                <TableHead className="hidden md:table-cell">Assigned Stores</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-24">Actions</TableHead>
                            </TableRow>
                            </TableHeader>
                            <TableBody>
                            {groupedItems[category].map((item) => (
                                <TableRow key={item.id}>
                                <TableCell>{item.item}</TableCell>
                                <TableCell className="hidden sm:table-cell">{item.subCategory}</TableCell>
                                <TableCell className="hidden md:table-cell">
                                    <div className="flex flex-wrap gap-1">
                                    {item.storeIds?.map(id => (
                                        <Badge key={id} variant="secondary">{stores.find(s => s.id === id)?.storeName || '...'}</Badge>
                                    ))}
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant={item.is_active ? 'default' : 'destructive'} className={item.is_active ? 'bg-green-500' : ''}>
                                    {item.is_active ? 'Active' : 'Inactive'}
                                    </Badge>
                                </TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditItem(item)}><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {setDeleteTargetId(item.id); setDeleteTargetType('item');}}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
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
      </section>

      <Separator />

       {/* Discount Types Section */}
      <section>
        <Accordion type="single" collapsible defaultValue="discounts" className="w-full">
            <AccordionItem value="discounts" className="border-0">
                <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
                    <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                        <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                            <div className='flex items-center gap-2'>
                                <h2 className="text-lg font-semibold font-headline">Discount Types</h2>
                                <Badge variant="secondary">{discountTypes.length}</Badge>
                            </div>
                        </AccordionTrigger>
                        <Button
                            size="sm"
                            className="flex items-center gap-2 mx-4"
                            onClick={(e) => { e.stopPropagation(); handleDiscountModalOpenChange(true); }}
                        >
                            <PlusCircle className="h-4 w-4" />
                            <span>Add Discount Type</span>
                        </Button>
                    </div>
                    <AccordionContent className="p-0">
                        <ScrollArea className="w-full max-w-full">
                            <div className="border-t">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Display Name</TableHead>
                                            <TableHead className="hidden sm:table-cell">Code</TableHead>
                                            <TableHead className="hidden md:table-cell">Type</TableHead>
                                            <TableHead>Value</TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead className="w-24">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {discountTypes.map(d => (
                                            <TableRow key={d.id}>
                                                <TableCell>{d.item}</TableCell>
                                                <TableCell className="hidden sm:table-cell">{d.code}</TableCell>
                                                <TableCell className="hidden md:table-cell">{d.discountMode}</TableCell>
                                                <TableCell>{d.discountMode === 'PCT' ? `${d.discountValue}%` : `₱${d.discountValue}`}</TableCell>
                                                <TableCell>
                                                    <Badge variant={d.is_active ? 'default' : 'destructive'} className={d.is_active ? 'bg-green-500' : ''}>
                                                        {d.is_active ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditDiscountType(d)}><Pencil className="h-4 w-4" /></Button>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeleteTargetId(d.id); setDeleteTargetType('discount'); }}>
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                                {discountTypes.length === 0 && <p className="text-center text-sm text-muted-foreground p-8">No discount types created yet.</p>}
                            </div>
                        </ScrollArea>
                    </AccordionContent>
                </div>
            </AccordionItem>
        </Accordion>
      </section>
      
      <Separator />
      
      {/* Tax Profiles Section */}
      <section>
        <Accordion type="single" collapsible defaultValue="taxes" className="w-full">
            <AccordionItem value="taxes" className="border-0">
                <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
                    <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                        <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                            <div className='flex items-center gap-2'>
                                <h2 className="text-lg font-semibold font-headline">Tax Profiles</h2>
                                <Badge variant="secondary">{taxRates.length}</Badge>
                            </div>
                        </AccordionTrigger>
                        <Button
                            size="sm"
                            className="flex items-center gap-2 mx-4"
                            onClick={(e) => { e.stopPropagation(); handleTaxModalOpenChange(true); }}
                        >
                            <PlusCircle className="h-4 w-4" />
                            <span>Add Tax Profile</span>
                        </Button>
                    </div>
                    <AccordionContent className="p-0">
                        <ScrollArea className="w-full max-w-full">
                        <div className="border-t">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Display Name</TableHead>
                                        <TableHead className="hidden sm:table-cell">Code</TableHead>
                                        <TableHead>Rate</TableHead>
                                        <TableHead className="hidden md:table-cell">Inclusive</TableHead>
                                        <TableHead className="hidden lg:table-cell">Assigned Stores</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="w-24">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {taxRates.map(rate => (
                                        <TableRow key={rate.id}>
                                            <TableCell>{rate.item}</TableCell>
                                            <TableCell className="hidden sm:table-cell">{rate.code}</TableCell>
                                            <TableCell>{(rate.rate * 100).toFixed(2)}%</TableCell>
                                            <TableCell className="hidden md:table-cell">{rate.isInclusive ? 'Yes' : 'No'}</TableCell>
                                            <TableCell className="hidden lg:table-cell">
                                                <div className="flex flex-wrap gap-1">
                                                    {rate.storeIds?.map(id => (
                                                        <Badge key={id} variant="secondary">{stores.find(s => s.id === id)?.storeName || '...'}</Badge>
                                                    ))}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={rate.is_active ? 'default' : 'destructive'} className={rate.is_active ? 'bg-green-500' : ''}>
                                                    {rate.is_active ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditTaxRate(rate)}><Pencil className="h-4 w-4" /></Button>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setDeleteTargetId(rate.id); setDeleteTargetType('tax'); }}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            {taxRates.length === 0 && <p className="text-center text-sm text-muted-foreground p-8">No tax profiles created yet.</p>}
                        </div>
                        </ScrollArea>
                    </AccordionContent>
                </div>
            </AccordionItem>
        </Accordion>
      </section>

      <Separator />

      {/* Menu Schedules Section */}
      <section>
        <Accordion type="single" collapsible defaultValue="schedules" className="w-full">
          <AccordionItem value="schedules" className="border-0">
            <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
              <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                  <div className='flex items-center gap-2'>
                    <h2 className="text-lg font-semibold font-headline">Menu Schedules</h2>
                    <Badge variant="secondary">{schedules.length}</Badge>
                  </div>
                </AccordionTrigger>
                <Button
                  size="sm"
                  className="flex items-center gap-2 mx-4"
                  onClick={(e) => { e.stopPropagation(); handleScheduleModalOpenChange(true); }}
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Add Schedule</span>
                </Button>
              </div>
              <AccordionContent className="p-0">
                <ScrollArea className="w-full max-w-full">
                    <div className="border-t">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Schedule Name</TableHead>
                            <TableHead className="hidden sm:table-cell">Time</TableHead>
                            <TableHead>Days</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-24">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {schedules.map(schedule => (
                            <TableRow key={schedule.id}>
                              <TableCell>{schedule.item}</TableCell>
                              <TableCell className="hidden sm:table-cell">{schedule.startTime} - {schedule.endTime}</TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {schedule.days.map((day:string) => <Badge key={day} variant="outline">{day}</Badge>)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant={schedule.is_active ? 'default' : 'destructive'} className={schedule.is_active ? 'bg-green-500' : ''}>
                                  {schedule.is_active ? 'Active' : 'Inactive'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditSchedule(schedule)}><Pencil className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {setDeleteTargetId(schedule.id); setDeleteTargetType('schedule');}}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {schedules.length === 0 && <p className="text-center text-sm text-muted-foreground p-8">No schedules created yet.</p>}
                    </div>
                </ScrollArea>
              </AccordionContent>
            </div>
          </AccordionItem>
        </Accordion>
      </section>

      {/* Item Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={handleItemModalOpenChange}>
        <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleItemSubmit}>
            <div className="grid gap-4 py-4">
                <div className="space-y-2">
                <Label htmlFor="storeIds">Store (required)</Label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                        <span>{getSelectedStoreNames('item')}</span>
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem onSelect={() => setItemFormData(prev => ({...prev, storeIds: stores.map(s => s.id)}))}>Select All</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setItemFormData(prev => ({...prev, storeIds: []}))}>Select None</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {stores.map(store => (
                            <DropdownMenuCheckboxItem
                                key={store.id}
                                checked={itemFormData.storeIds.includes(store.id)}
                                onSelect={(e) => e.preventDefault()}
                                onClick={() => handleStoreIdChange(store.id)}
                            >
                                {store.storeName}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                </div>
                <div className="space-y-2">
                <Label htmlFor="item">Item</Label>
                <Input id="item" name="item" value={itemFormData.item} onChange={handleItemInputChange} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="category">Category</Label>
                        <Input id="category" name="category" value={itemFormData.category} onChange={handleItemInputChange} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="subCategory">Sub-category</Label>
                        <Input id="subCategory" name="subCategory" value={itemFormData.subCategory} onChange={handleItemInputChange} />
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                <Switch id="is_active" name="is_active" checked={itemFormData.is_active} onCheckedChange={handleItemSwitchChange} />
                <Label htmlFor="is_active">Active</Label>
                </div>
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => handleItemModalOpenChange(false)}>Cancel</Button>
                <Button type="submit">{editingItem ? 'Save Changes' : 'Save'}</Button>
            </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>
      
      {/* Schedule Modal */}
       <Dialog open={isScheduleModalOpen} onOpenChange={handleScheduleModalOpenChange}>
            <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>{editingSchedule ? 'Edit Schedule' : 'Add New Schedule'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleScheduleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="item">Schedule Name</Label>
                    <Input id="item" name="item" value={scheduleFormData.item} onChange={handleScheduleInputChange} required placeholder="e.g., Breakfast Menu, Happy Hour" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="startTime">Start Time</Label>
                        <Input id="startTime" name="startTime" type="time" value={scheduleFormData.startTime} onChange={handleScheduleInputChange} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="endTime">End Time</Label>
                        <Input id="endTime" name="endTime" type="time" value={scheduleFormData.endTime} onChange={handleScheduleInputChange} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Days Active</Label>
                    <div className="flex flex-wrap gap-2 rounded-lg border p-3">
                        {DAYS_OF_WEEK.map(day => (
                             <div key={day} className="flex items-center space-x-2">
                                <Checkbox
                                    id={`day-${day}`}
                                    checked={scheduleFormData.days.includes(day)}
                                    onCheckedChange={() => handleDayChange(day)}
                                />
                                <Label htmlFor={`day-${day}`} className="font-normal">{day}</Label>
                            </div>
                        ))}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Switch id="is_active_schedule" name="is_active" checked={scheduleFormData.is_active} onCheckedChange={handleScheduleSwitchChange} />
                    <Label htmlFor="is_active_schedule">Active</Label>
                  </div>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => handleScheduleModalOpenChange(false)}>Cancel</Button>
                  <Button type="submit">{editingSchedule ? 'Save Changes' : 'Save'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
        </Dialog>
        
      {/* Tax Modal */}
      <Dialog open={isTaxModalOpen} onOpenChange={handleTaxModalOpenChange}>
        <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingTaxRate ? 'Edit Tax Profile' : 'Add New Tax Profile'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTaxSubmit}>
            <div className="grid gap-4 py-4">
               <div className="space-y-2">
                <Label htmlFor="tax_storeIds">Store (required)</Label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                        <span>{getSelectedStoreNames('tax')}</span>
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem onSelect={() => setTaxFormData(prev => ({...prev, storeIds: stores.map(s => s.id)}))}>Select All</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTaxFormData(prev => ({...prev, storeIds: []}))}>Select None</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {stores.map(store => (
                            <DropdownMenuCheckboxItem
                                key={store.id}
                                checked={taxFormData.storeIds.includes(store.id)}
                                onSelect={(e) => e.preventDefault()}
                                onClick={() => handleTaxStoreIdChange(store.id)}
                            >
                                {store.storeName}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="tax_item">Display Name</Label>
                    <Input id="tax_item" name="item" value={taxFormData.item} onChange={handleTaxInputChange} required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="tax_code">Code</Label>
                        <Input id="tax_code" name="code" value={taxFormData.code} onChange={handleTaxInputChange} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="tax_rate">Rate (%)</Label>
                        <Input id="tax_rate" name="rate" type="number" step="0.01" value={taxFormData.rate * 100} onChange={handleTaxInputChange} required />
                    </div>
                </div>
                 <div className="flex items-center space-x-2">
                    <Switch id="isInclusive" name="isInclusive" checked={taxFormData.isInclusive} onCheckedChange={(c) => handleTaxSwitchChange('isInclusive', c)} />
                    <Label htmlFor="isInclusive">Is Price Inclusive?</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Switch id="is_active_tax" name="is_active" checked={taxFormData.is_active} onCheckedChange={(c) => handleTaxSwitchChange('is_active', c)} />
                    <Label htmlFor="is_active_tax">Active</Label>
                </div>
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleTaxModalOpenChange(false)}>Cancel</Button>
              <Button type="submit">{editingTaxRate ? 'Save Changes' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
       {/* Discount Modal */}
      <Dialog open={isDiscountModalOpen} onOpenChange={handleDiscountModalOpenChange}>
        <DialogContent className="sm:max-w-2xl" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{editingDiscountType ? 'Edit Discount Type' : 'Add New Discount Type'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDiscountSubmit}>
            <div className="grid gap-6 py-4">
               <div className="space-y-2">
                <Label htmlFor="discount_storeIds">Store (required)</Label>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                        <span>{getSelectedStoreNames('discount')}</span>
                        <ChevronDown className="h-4 w-4" />
                    </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuItem onSelect={() => setDiscountFormData(prev => ({...prev, storeIds: stores.map(s => s.id)}))}>Select All</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDiscountFormData(prev => ({...prev, storeIds: []}))}>Select None</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {stores.map(store => (
                            <DropdownMenuCheckboxItem
                                key={store.id}
                                checked={discountFormData.storeIds.includes(store.id)}
                                onSelect={(e) => e.preventDefault()}
                                onClick={() => handleDiscountStoreIdChange(store.id)}
                            >
                                {store.storeName}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="discount_item">Display Name</Label>
                        <Input id="discount_item" name="item" value={discountFormData.item} onChange={handleDiscountInputChange} required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="discount_code">Code</Label>
                        <Input id="discount_code" name="code" value={discountFormData.code} onChange={handleDiscountInputChange} required />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="discountMode">Discount Mode</Label>
                        <Select name="discountMode" value={discountFormData.discountMode} onValueChange={(v) => handleDiscountSelectChange('discountMode', v)}>
                           <SelectTrigger><SelectValue/></SelectTrigger>
                           <SelectContent>
                               <SelectItem value="PCT">Percentage</SelectItem>
                               <SelectItem value="ABS">Absolute</SelectItem>
                           </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="discountValue">Value</Label>
                        <Input id="discountValue" name="discountValue" type="number" value={discountFormData.discountValue} onChange={handleDiscountInputChange} required />
                         <p className="text-xs text-muted-foreground">Enter % (e.g., 20) or ₱ amount</p>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="appliesTo">Applies To</Label>
                        <Select name="appliesTo" value={discountFormData.appliesTo} onValueChange={(v) => handleDiscountSelectChange('appliesTo', v)}>
                           <SelectTrigger><SelectValue/></SelectTrigger>
                           <SelectContent>
                               <SelectItem value="bill">Entire Bill</SelectItem>
                               <SelectItem value="line">Specific Item (Line)</SelectItem>
                           </SelectContent>
                        </Select>
                    </div>
                </div>
                 <div className="flex items-center space-x-6 pt-4">
                    <div className="flex items-center space-x-2">
                        <Switch id="requiresName" checked={discountFormData.requiresName} onCheckedChange={(c) => handleDiscountSwitchChange('requiresName', c)} />
                        <Label htmlFor="requiresName">Requires Name</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch id="requiresTin" checked={discountFormData.requiresTin} onCheckedChange={(c) => handleDiscountSwitchChange('requiresTin', c)} />
                        <Label htmlFor="requiresTin">Requires TIN</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch id="is_active_discount" checked={discountFormData.is_active} onCheckedChange={(c) => handleDiscountSwitchChange('is_active', c)} />
                        <Label htmlFor="is_active_discount">Active</Label>
                    </div>
                </div>
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => handleDiscountModalOpenChange(false)}>Cancel</Button>
              <Button type="submit">{editingDiscountType ? 'Save Changes' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


        <AlertDialog
            open={!!deleteTargetId}
            onOpenChange={(open) => {
                if (!open) {
                setDeleteTargetId(null);
                setDeleteTargetType(null);
                }
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                <AlertDialogTitle>
                    {deleteTargetType === 'schedule'
                    ? "Delete schedule?"
                    : deleteTargetType === 'tax'
                    ? "Delete tax profile?"
                    : deleteTargetType === 'discount'
                    ? "Delete discount type?"
                    : "Delete list item?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                    This action cannot be undone. The {deleteTargetType} will be permanently removed.
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                    Delete
                </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
      </main>
  );
}

    

    