
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
  collection,
  doc,
  onSnapshot,
  deleteDoc,
} from 'firebase/firestore';
import Link from 'next/link';
import { Store } from '@/lib/types';


export default function StorePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const firestore = useFirestore();
  const router = useRouter();

  useEffect(() => {
    if (firestore) {
      const unsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });
      return () => unsubscribe();
    }
  }, [firestore]);


  const handleDelete = async (storeId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'stores', storeId));
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };
  
  const handleRowClick = (storeId: string) => {
    router.push(`/admin/store/${storeId}`);
  };


  return (
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Stores
        </h1>
        <Button size="sm" className="flex items-center gap-2" asChild>
            <Link href="/admin/store/new">
                <PlusCircle className="h-4 w-4" />
                <span>Add Store</span>
            </Link>
        </Button>
      </div>
      
      <div className="rounded-lg border shadow-sm bg-background overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Store Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Contact No.</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Opening Date</TableHead>
              <TableHead>Status</TableHead>
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
                <TableCell>{store.openingDate || 'N/A'}</TableCell>
                <TableCell>
                  <Badge
                    variant={store.status === 'Active' ? 'default' : 'destructive'}
                    className={store.status === 'Active' ? 'bg-green-500' : ''}
                  >
                    {store.status}
                  </Badge>
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
                      <DropdownMenuItem onSelect={() => router.push(`/admin/store/${store.id}/edit`)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleDelete(store.id)} className="text-destructive">Delete</DropdownMenuItem>
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
