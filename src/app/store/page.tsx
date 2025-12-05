'use client';

import { useState } from 'react';
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
import { addDoc, collection, doc, setDoc } from 'firebase/firestore';

type Store = {
  id?: string;
  storeName: string;
  type: 'resto' | 'kiosk';
  contactNo: string;
  email: string;
  logo?: string;
  address: string;
  status: 'Active' | 'Inactive';
  tags: ('Foodpanda' | 'Grab' | 'Dine in' | 'Take Out')[];
};

const storesData: Store[] = [
  {
    id: 'ST-001',
    storeName: 'Main Street Branch',
    type: 'resto',
    contactNo: '123-456-7890',
    email: 'main@shareat.com',
    address: '123 Main St, Cityville',
    status: 'Active',
    tags: ['Dine in', 'Take Out'],
  },
  {
    id: 'ST-002',
    storeName: 'Downtown Cafe',
    type: 'kiosk',
    contactNo: '987-654-3210',
    email: 'downtown@shareat.com',
    address: '456 Downtown Ave, Townburg',
    status: 'Active',
    tags: ['Foodpanda', 'Grab'],
  },
  {
    id: 'ST-003',
    storeName: 'Uptown Diner',
    type: 'resto',
    contactNo: '555-123-4567',
    email: 'uptown@shareat.com',
    address: '789 Uptown Rd, Metropolis',
    status: 'Inactive',
    tags: ['Dine in'],
  },
];

export default function StorePage() {
  const [stores, setStores] = useState<Store[]>(storesData);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const firestore = useFirestore();

  const handleAddStore = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newStore: Store = {
      storeName: formData.get('storeName') as string,
      type: formData.get('type') as 'resto' | 'kiosk',
      contactNo: formData.get('contactNo') as string,
      email: formData.get('email') as string,
      address: formData.get('address') as string,
      status: formData.get('status') as 'Active' | 'Inactive',
      tags: formData.getAll('tags') as ('Foodpanda' | 'Grab' | 'Dine in' | 'Take Out')[],
      logo: '',
    };

    try {
      const docRef = await addDoc(collection(firestore, 'stores'), newStore);
      setStores([...stores, { ...newStore, id: docRef.id }]);
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error adding document: ', error);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Stores
        </h1>
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="flex items-center gap-2">
              <PlusCircle className="h-4 w-4" />
              <span>Add Store</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add New Store</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddStore}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="storeName">Store Name</Label>
                  <Input id="storeName" name="storeName" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select name="type" required>
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
                  <Input id="contactNo" name="contactNo" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="logo">Logo</Label>
                  <Input id="logo" name="logo" type="file" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select name="status" required>
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
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit">Save</Button>
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
                <TableCell className="font-medium">{store.id}</TableCell>
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
                      <DropdownMenuItem>Edit</DropdownMenuItem>
                      <DropdownMenuItem>Delete</DropdownMenuItem>
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
