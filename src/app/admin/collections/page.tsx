
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
import { Store } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';

interface CollectionItem {
    id: string;
    item: string;
    category: string;
    is_active: boolean;
    storeIds: string[];
}

const initialItemState: Omit<CollectionItem, 'id'> = {
  item: '',
  category: '',
  is_active: true,
  storeIds: [],
};

export default function CollectionsPage() {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CollectionItem | null>(null);
  const [itemFormData, setItemFormData] = useState<Omit<CollectionItem, 'id'>>(initialItemState);
  
  const firestore = useFirestore();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    const q = query(collection(firestore, 'collections'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CollectionItem[];
      setItems(allItems.map(item => ({ ...item, storeIds: item.storeIds || [] })));
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
        await updateDoc(doc(firestore, 'collections', editingItem.id), itemFormData);
      } else {
        await addDoc(collection(firestore, 'collections'), itemFormData);
      }
      handleItemModalOpenChange(false);
      openSuccessModal();
    } catch (error) {
       console.error("Save error:", error);
       toast({ variant: "destructive", title: "Uh oh! Something went wrong.", description: "There was a problem with your request." });
    }
  };
  
  const handleEditItem = (item: CollectionItem) => {
    setEditingItem(item);
    setItemFormData({
      item: item.item,
      category: item.category,
      is_active: item.is_active,
      storeIds: item.storeIds || [],
    });
    setIsItemModalOpen(true);
  };
  
  const handleDelete = async (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (!firestore) return;
    if (!window.confirm('Are you sure you want to delete this?')) return;
    try {
      await deleteDoc(doc(firestore, 'collections', itemId));
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
  }, {} as Record<string, CollectionItem[]>);
  
  return (
      <main className="flex flex-1 flex-col gap-6 p-4 lg:gap-8 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Collections
        </h1>
         <Button size="sm" className="flex items-center gap-2" onClick={openAddItemModal}>
            <PlusCircle className="h-4 w-4" />
            <span>Add Item</span>
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
                        <TableRow key={item.id} onClick={() => handleEditItem(item)} className="cursor-pointer">
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
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); handleEditItem(item);}}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => handleDelete(e, item.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
      </main>
  );
}
