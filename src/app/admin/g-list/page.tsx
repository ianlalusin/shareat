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
import { PlusCircle, MoreHorizontal, ChevronDown, Plus, Download } from 'lucide-react';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

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
    if (isModalOpen) {
        if (editingItem) {
            setFormData({
                item: editingItem.item,
                category: editingItem.category,
                is_active: editingItem.is_active,
                storeIds: editingItem.storeIds || [],
            });
        } else {
            // If we are not editing, it's a new item.
            // We might want to preserve the category if `openAddModalForCategory` was used.
            // This is handled by `openAddModal` and `openAddModalForCategory` now.
        }
    } else {
        // When modal closes, reset everything
        setEditingItem(null);
        setFormData(initialItemState);
    }
}, [isModalOpen, editingItem]);


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
      } else {
        await addDoc(collection(firestore, 'lists'), dataToSave);
      }
      setIsModalOpen(false); // Close modal only after successful save
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
    try {
      await deleteDoc(doc(firestore, 'lists', itemId));
    } catch (error) {
      console.error("Error deleting document: ", error);
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

  const groupedItems = items.reduce((acc, item) => {
    const category = item.category || 'Uncategorized';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<string, GListItem[]>);
  
  const handleDownload = async () => {
    if (items.length === 0) {
      alert("No data to download.");
      return;
    }
    
    // Dynamically import libraries here
    const XLSX = await import('xlsx');
    const { saveAs } = await import('file-saver');

    const dataToExport = items.map(item => ({
      'Item': item.item,
      'Category': item.category,
      'Status': item.is_active ? 'Active' : 'Inactive',
      'Assigned Stores': getStoreNames(item.storeIds),
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "G-List");

    const cols = [
      { wch: 30 }, // Item
      { wch: 20 }, // Category
      { wch: 10 }, // Status
      { wch: 40 }, // Assigned Stores
    ];
    worksheet['!cols'] = cols;
    
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const data = new Blob([excelBuffer], { type: 'application/octet-stream' });
    saveAs(data, 'G-List.xlsx');
  };

  return (
      <main className="flex flex-1 flex-col gap-2 p-2 lg:gap-3 lg:p-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          G.List
        </h1>
        <div className="flex items-center gap-2">
           <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
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
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingItem ? 'Save Changes' : 'Save'}</Button>
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
                    openAddModalForCategory(category);
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
               </div>
              <AccordionContent className="p-0">
                <div className="border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-2 h-10">Item</TableHead>
                        <TableHead className="px-2 h-10">Store</TableHead>
                        <TableHead className="px-2 h-10">Status</TableHead>
                        <TableHead className="px-2 h-10">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {itemsInCategory.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="p-2">{item.item}</TableCell>
                          <TableCell className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {item.storeIds?.map(id => (
                                <Badge key={id} variant="secondary">{stores.find(s => s.id === id)?.storeName || '...'}</Badge>
                              ))}
                            </div>
                          </TableCell>
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
                                <DropdownMenuItem onSelect={() => handleDelete(item.id)} className="text-destructive">Delete</DropdownMenuItem>
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

    