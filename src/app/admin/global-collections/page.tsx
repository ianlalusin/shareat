
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
import { PlusCircle, MoreHorizontal, ChevronDown, Plus, Download, Pencil, Trash2 } from 'lucide-react';
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
} from 'firebase/firestore';
import { Switch } from '@/components/ui/switch';
import { GListItem, Store } from '@/lib/types';
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

const initialItemState: Omit<GListItem, 'id'> = {
  item: '',
  category: '',
  is_active: true,
  storeIds: [],
};

const initialScheduleState: any = {
    item: '',
    category: 'menu schedules',
    is_active: true,
    startTime: '',
    endTime: '',
    days: [],
};

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function GlobalCollectionsPage() {
  const [items, setItems] = useState<GListItem[]>([]);
  const [schedules, setSchedules] = useState<GListItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GListItem | null>(null);
  const [itemFormData, setItemFormData] = useState<Omit<GListItem, 'id'>>(initialItemState);
  
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<GListItem | null>(null);
  const [scheduleFormData, setScheduleFormData] = useState(initialScheduleState);

  const firestore = useFirestore();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    const q = query(collection(firestore, 'lists'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
      setItems(allItems.filter(item => item.category !== 'menu schedules').map(item => ({ ...item, storeIds: item.storeIds || [] })));
      setSchedules(allItems.filter(item => item.category === 'menu schedules').map(item => ({...item, days: (item as any).days || []})));
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

    try {
      if (editingItem) {
        await updateDoc(doc(firestore, 'lists', editingItem.id), itemFormData);
      } else {
        await addDoc(collection(firestore, 'lists'), itemFormData);
      }
      handleItemModalOpenChange(false);
      openSuccessModal();
    } catch (error) {
       console.error("Save error:", error);
       toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "There was a problem with your request." });
    }
  };
  
  const handleEditItem = (item: GListItem) => {
    setEditingItem(item);
    setItemFormData({
      item: item.item,
      category: item.category,
      is_active: item.is_active,
      storeIds: item.storeIds || [],
    });
    setIsItemModalOpen(true);
  };
  
  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    console.log("Deleting item:", itemId); // DEBUG
    if (!window.confirm('Are you sure you want to delete this?')) return;
    try {
      await deleteDoc(doc(firestore, 'lists', itemId));
      toast({ title: "Success!", description: "The entry has been deleted." });
    } catch (error) {
       console.error("Delete error:", error);
       toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "Could not delete. Please try again." });
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
  
  const getSelectedStoreNames = () => {
    if (itemFormData.storeIds.length === 0) return "Select stores";
    if (itemFormData.storeIds.length === stores.length) return "All stores selected";
    if (itemFormData.storeIds.length > 2) return `${itemFormData.storeIds.length} stores selected`;
    return stores
        .filter(s => itemFormData.storeIds.includes(s.id))
        .map(s => s.storeName)
        .join(', ');
  };
  
  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) { acc[category] = []; }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, GListItem[]>);
  
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
    setScheduleFormData((prev:any) => ({ ...prev, [name]: value }));
  };

  const handleDayChange = (day: string) => {
    setScheduleFormData((prev:any) => {
        const newDays = prev.days.includes(day)
            ? prev.days.filter((d:string) => d !== day)
            : [...prev.days, day];
        return {...prev, days: newDays };
    });
  };

  const handleScheduleSwitchChange = (checked: boolean) => {
    setScheduleFormData((prev:any) => ({ ...prev, is_active: checked }));
  };

  const handleScheduleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;
    try {
      if (editingSchedule) {
        await updateDoc(doc(firestore, 'lists', editingSchedule.id), scheduleFormData);
      } else {
        await addDoc(collection(firestore, 'lists'), scheduleFormData);
      }
      handleScheduleModalOpenChange(false);
      openSuccessModal();
    } catch (error) {
       console.error("Save error:", error);
       toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "Could not save schedule." });
    }
  };

  const handleEditSchedule = (schedule: GListItem) => {
    setEditingSchedule(schedule);
    setScheduleFormData({
        item: schedule.item,
        category: schedule.category,
        is_active: schedule.is_active,
        startTime: (schedule as any).startTime || '',
        endTime: (schedule as any).endTime || '',
        days: (schedule as any).days || [],
    });
    setIsScheduleModalOpen(true);
  };
  
  return (
      <main className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Global Collections
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
                    <div className="border-t">
                    <Table>
                        <TableHeader>
                        <TableRow>
                            <TableHead>Item</TableHead>
                            <TableHead>Assigned Stores</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="w-24">Actions</TableHead>
                        </TableRow>
                        </TableHeader>
                        <TableBody>
                        {groupedItems[category].map((item) => (
                            <TableRow key={item.id}>
                            <TableCell>{item.item}</TableCell>
                            <TableCell>
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
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
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
      </section>

      <Separator />

      {/* Menu Schedules Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold font-headline">Menu Schedules</h2>
            <Button size="sm" className="flex items-center gap-2" onClick={() => handleScheduleModalOpenChange(true)}>
                <PlusCircle className="h-4 w-4" />
                <span>Add Schedule</span>
            </Button>
        </div>
         <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
             <Table>
                 <TableHeader>
                     <TableRow>
                         <TableHead>Schedule Name</TableHead>
                         <TableHead>Time</TableHead>
                         <TableHead>Days</TableHead>
                         <TableHead>Status</TableHead>
                         <TableHead className="w-24">Actions</TableHead>
                     </TableRow>
                 </TableHeader>
                 <TableBody>
                     {schedules.map(schedule => (
                         <TableRow key={schedule.id}>
                             <TableCell>{schedule.item}</TableCell>
                             <TableCell>{(schedule as any).startTime} - {(schedule as any).endTime}</TableCell>
                             <TableCell>
                                 <div className="flex flex-wrap gap-1">
                                     {((schedule as any).days || []).map((day:string) => <Badge key={day} variant="outline">{day}</Badge>)}
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
                                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(schedule.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                            </TableCell>
                         </TableRow>
                     ))}
                 </TableBody>
             </Table>
             {schedules.length === 0 && <p className="text-center text-sm text-muted-foreground p-8">No schedules created yet.</p>}
        </div>
      </section>

      {/* Item Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={handleItemModalOpenChange}>
        <DialogContent className="sm:max-w-md">
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
                        <span>{getSelectedStoreNames()}</span>
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
                <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" name="category" value={itemFormData.category} onChange={handleItemInputChange} required />
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
            <DialogContent className="sm:max-w-lg">
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
      </main>
  );
}

    