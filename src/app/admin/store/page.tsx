'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
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
  where
} from 'firebase/firestore';
import { Textarea } from '@/components/ui/textarea';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

type Store = {
  id: string;
  storeName: string;
  type: 'resto' | 'kiosk';
  contactNo: string;
  email: string;
  logo?: string;
  address: string;
  description: string;
  status: 'Active' | 'Inactive';
  tags: string[];
  openingDate?: Date | string;
};

type GListItem = {
  id: string;
  item: string;
  category: string;
  is_active: boolean;
};

const initialStoreState: Omit<Store, 'id'> = {
  storeName: '',
  type: 'resto',
  contactNo: '',
  email: '',
  address: '',
  description: '',
  status: 'Active',
  tags: [],
  logo: '',
  openingDate: new Date(),
};

export default function StorePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [formData, setFormData] = useState<Omit<Store, 'id'>>(initialStoreState);
  const [storeTags, setStoreTags] = useState<GListItem[]>([]);
  const firestore = useFirestore();
  const router = useRouter();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date | undefined>(new Date());

  const yearRange = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return {
      fromYear: 1990,
      toYear: currentYear,
    };
  }, []);

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });

      const tagsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'Store tags'),
        where('is_active', '==', true)
      );

      const unsubscribeTags = onSnapshot(tagsQuery, (snapshot) => {
        const tagsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setStoreTags(tagsData);
      });

      return () => {
        unsubscribe();
        unsubscribeTags();
      }
    }
  }, [firestore]);


  useEffect(() => {
    if (editingStore) {
      const openingDate = editingStore.openingDate ? new Date(editingStore.openingDate as any) : new Date();
      setFormData({
        ...editingStore,
        openingDate,
      });
      setTempDate(openingDate)
    } else {
      setFormData(initialStoreState);
      setTempDate(initialStoreState.openingDate ? new Date(initialStoreState.openingDate) : new Date());
    }
  }, [editingStore]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
     setFormData((prev) => ({ ...prev, [name]: value }));
  }

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData((prev) => ({...prev, openingDate: date}));
    }
  }

  const confirmDate = () => {
    handleDateChange(tempDate);
    setIsDatePickerOpen(false);
  }

  const handleTagChange = (tag: string, checked: boolean) => {
    setFormData((prev) => {
      const newTags = checked
        ? [...prev.tags, tag]
        : prev.tags.filter((t) => t !== tag);
      return { ...prev, tags: newTags as Store['tags'] };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore) return;

    const dataToSave = {
      ...formData,
      openingDate: formData.openingDate instanceof Date ? formData.openingDate.toISOString() : formData.openingDate
    };

    try {
      if (editingStore) {
        const storeRef = doc(firestore, 'stores', editingStore.id);
        await updateDoc(storeRef, dataToSave);
        setEditingStore(null);
      } else {
        await addDoc(collection(firestore, 'stores'), dataToSave);
      }
      setFormData(initialStoreState);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };
  
  const handleEdit = (e: React.MouseEvent, store: Store) => {
    e.stopPropagation();
    setEditingStore(store);
    setIsModalOpen(true);
  };

  const handleDelete = async (e: React.MouseEvent, storeId: string) => {
    e.stopPropagation();
    if (!firestore) return;
    if (window.confirm('Are you sure you want to delete this store?')) {
      try {
        await deleteDoc(doc(firestore, 'stores', storeId));
      } catch (error) {
        console.error("Error deleting document: ", error);
      }
    }
  };

  const openAddModal = () => {
    setEditingStore(null);
    setFormData(initialStoreState);
    setIsModalOpen(true);
  }
  
  const handleRowClick = (storeId: string) => {
    router.push(`/admin/store/${storeId}`);
  };


  return (
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Stores
        </h1>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2" onClick={openAddModal}>
              <PlusCircle className="h-4 w-4" />
              <span>Add Store</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{editingStore ? 'Edit Store' : 'Add New Store'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="storeName">Store Name</Label>
                  <Input id="storeName" name="storeName" value={formData.storeName} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select name="type" value={formData.type} onValueChange={(value) => handleSelectChange('type', value)} required>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="resto">Resto</SelectItem>
                      <SelectItem value="kiosk">Kiosk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactNo">Contact No.</Label>
                  <Input id="contactNo" name="contactNo" value={formData.contactNo} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="logo">Logo</Label>
                  <Input id="logo" name="logo" type="file" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" value={formData.address} onChange={handleInputChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openingDate">Opening Date</Label>
                   <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant={"outline"}
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !formData.openingDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.openingDate ? format(new Date(formData.openingDate), "PPP") : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <Calendar
                        mode="single"
                        selected={tempDate}
                        onSelect={setTempDate}
                        captionLayout="dropdown-buttons"
                        fromYear={yearRange.fromYear}
                        toYear={yearRange.toYear}
                        initialFocus
                      />
                      <div className="p-2 border-t border-border">
                        <Button size="sm" className="w-full" onClick={confirmDate}>Confirm</Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                   <Select name="status" value={formData.status} onValueChange={(value) => handleSelectChange('status', value)} required>
                    <SelectTrigger id="status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Active">Active</SelectItem>
                      <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-4">
                    {storeTags.map((tag) => (
                      <div key={tag.id} className="flex items-center gap-2">
                        <Input
                          type="checkbox"
                          id={`tag-${tag.item}`}
                          name="tags"
                          value={tag.item}
                          checked={formData.tags.includes(tag.item as any)}
                          onChange={(e) => handleTagChange(tag.item, e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor={`tag-${tag.item}`}>{tag.item}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit">{editingStore ? 'Save Changes' : 'Save'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="rounded-lg border shadow-sm bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact No.</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Opening Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((store) => (
              <TableRow key={store.id} onClick={() => handleRowClick(store.id)} className="cursor-pointer">
                <TableCell>{store.storeName}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{store.type}</Badge>
                </TableCell>
                <TableCell>{store.contactNo}</TableCell>
                <TableCell>{store.email}</TableCell>
                <TableCell>{store.openingDate ? format(new Date(store.openingDate as any), "PPP") : 'N/A'}</TableCell>
                <TableCell>
                  <Badge
                    variant={store.status === 'Active' ? 'default' : 'destructive'}
                    className={store.status === 'Active' ? 'bg-green-500' : ''}
                  >
                    {store.status}
                  </Badge>
                </TableCell>
                <TableCell className="flex flex-wrap gap-1">
                  {store.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={(e) => handleEdit(e as unknown as React.MouseEvent, store)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={(e) => handleDelete(e as unknown as React.MouseEvent, store.id)}>Delete</DropdownMenuItem>
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
