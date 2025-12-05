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
import { PlusCircle, MoreHorizontal, ChevronDown } from 'lucide-react';
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
} from 'firebase/firestore';
import { Switch } from '@/components/ui/switch';
import { GListItem, Store } from '@/lib/types';

const initialItemState: Omit<GListItem, 'id'> = {
  item: '',
  category: '',
  is_active: true,
  storeIds: [],
};

export default function GListPage() {
  const [items, setItems] = useState<GListItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GListItem | null>(null);
  const [formData, setFormData] = useState<Omit<GListItem, 'id'>>(initialItemState);
  const firestore = useFirestore();

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'lists'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setItems(itemsData.map(item => ({ ...item, storeIds: item.storeIds || [] })));
      });

      const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });

      return () => {
        unsubscribe();
        storesUnsubscribe();
      }
    }
  }, [firestore]);


  useEffect(() => {
    if (editingItem) {
      setFormData({
        item: editingItem.item,
        category: editingItem.category,
        is_active: editingItem.is_active,
        storeIds: editingItem.storeIds || [],
      });
    } else {
      setFormData(initialItemState);
    }
  }, [editingItem]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
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

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, is_active: checked }));
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || formData.storeIds.length === 0) {
        if (formData.storeIds.length === 0) {
            alert('Please select at least one store.');
        }
        return;
    }

    const dataToSave = { ...formData };

    try {
      if (editingItem) {
        const itemRef = doc(firestore, 'lists', editingItem.id);
        await updateDoc(itemRef, dataToSave);
        setEditingItem(null);
      } else {
        await addDoc(collection(firestore, 'lists'), dataToSave);
      }
      setFormData(initialItemState);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };
  
  const handleEdit = (item: GListItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (itemId: string) => {
    if (!firestore) return;
    if (window.confirm('Are you sure you want to delete this item?')) {
      try {
        await deleteDoc(doc(firestore, 'lists', itemId));
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

  const getStoreNames = (storeIds: string[] | undefined) => {
    if (!storeIds || storeIds.length === 0) return 'N/A';
    return storeIds.map(id => stores.find(s => s.id === id)?.storeName || 'Unknown').join(', ');
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

  return (
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          G.List
        </h1>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2" onClick={openAddModal}>
              <PlusCircle className="h-4 w-4" />
              <span>Add Item</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
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
                <div className="space-y-2">
                  <Label htmlFor="item">Item</Label>
                  <Input id="item" name="item" value={formData.item} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" value={formData.category} onChange={handleInputChange} required />
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
      <div className="rounded-lg border shadow-sm bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Store</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.item}</TableCell>
                <TableCell>{item.category}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.storeIds?.map(id => (
                      <Badge key={id} variant="secondary">{stores.find(s => s.id === id)?.storeName || '...'}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={item.is_active ? 'default' : 'destructive'}
                    className={item.is_active ? 'bg-green-500' : ''}
                  >
                    {item.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell>
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
      </main>
  );
}
