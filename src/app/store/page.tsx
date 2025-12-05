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
  TableHead,
  TableHeader,
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
  setDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
} from 'firebase/firestore';

type Store = {
  id: string;
  storeName: string;
  type: 'resto' | 'kiosk';
  contactNo: string;
  email: string;
  logo?: string;
  address: string;
  status: 'Active' | 'Inactive';
  tags: ('Foodpanda' | 'Grab' | 'Dine in' | 'Take Out')[];
};

const initialStoreState: Omit<Store, 'id'> = {
  storeName: '',
  type: 'resto',
  contactNo: '',
  email: '',
  address: '',
  status: 'Active',
  tags: [],
  logo: '',
};

export default function StorePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [formData, setFormData] = useState<Omit<Store, 'id'>>(initialStoreState);
  const firestore = useFirestore();

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });
      return () => unsubscribe();
    }
  }, [firestore]);


  useEffect(() => {
    if (editingStore) {
      setFormData(editingStore);
    } else {
      setFormData(initialStoreState);
    }
  }, [editingStore]);


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
     setFormData((prev) => ({ ...prev, [name]: value }));
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

    try {
      if (editingStore) {
        const storeRef = doc(firestore, 'stores', editingStore.id);
        await updateDoc(storeRef, formData);
        setEditingStore(null);
      } else {
        await addDoc(collection(firestore, 'stores'), formData);
      }
      setFormData(initialStoreState);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };
  
  const handleEdit = (store: Store) => {
    setEditingStore(store);
    setIsModalOpen(true);
  };

  const handleDelete = async (storeId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'stores', storeId));
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };

  const openAddModal = () => {
    setEditingStore(null);
    setFormData(initialStoreState);
    setIsModalOpen(true);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
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
          <DialogContent className="sm:max-w-2xl">
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
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {['Foodpanda', 'Grab', 'Dine in', 'Take Out'].map((tag) => (
                      <div key={tag} className="flex items-center gap-1">
                        <Input
                          type="checkbox"
                          id={`tag-${tag}`}
                          name="tags"
                          value={tag}
                          checked={formData.tags.includes(tag as any)}
                          onChange={(e) => handleTagChange(tag, e.target.checked)}
                          className="h-4 w-4"
                        />
                        <Label htmlFor={`tag-${tag}`}>{tag}</Label>
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
              <TableHead>ID</TableHead>
              <TableHead>Store Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact No.</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.map((store) => (
              <TableRow key={store.id}>
                <TableCell className="font-medium">{store.id.substring(0,6)}...</TableCell>
                <TableCell>{store.storeName}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{store.type}</Badge>
                </TableCell>
                <TableCell>{store.contactNo}</TableCell>
                <TableCell>{store.email}</TableCell>
                <TableCell>{store.address}</TableCell>
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
                      <DropdownMenuItem onSelect={() => handleEdit(store)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleDelete(store.id)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
