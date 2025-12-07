

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { doc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { notFound, useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Store as StoreIcon, ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Store } from '@/lib/types';
import { useSuccessModal } from '@/store/use-success-modal';


export default function StoreDetailPage() {
  const params = useParams();
  const storeId = params.storeId as string;
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const firestore = useFirestore();
  const router = useRouter();
  const { openSuccessModal } = useSuccessModal();

  useEffect(() => {
    if (!firestore || !storeId) return;
    setLoading(true);
    const docRef = doc(firestore, 'stores', storeId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as Omit<Store, 'id'>;
        setStore({ id: docSnap.id, ...data, tags: data.tags || [], mopAccepted: data.mopAccepted || [], tableLocations: data.tableLocations || [] });
      } else {
        setStore(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, storeId]);

  const handleDelete = async () => {
    if (!firestore || !storeId) return;
    try {
      await deleteDoc(doc(firestore, 'stores', storeId));
      openSuccessModal();
      router.push('/admin/store');
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };

  if (loading) {
    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled>
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back</span>
                </Button>
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="space-y-2">
                    <Skeleton className="h-8 w-48" />
                </div>
            </div>
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-full mt-2" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                     <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                </CardContent>
            </Card>
      </main>
    )
  }

  if (!store) {
    notFound();
  }
  
  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center gap-4 justify-between">
        <div className='flex items-center gap-4'>
            <Button asChild variant="outline" size="icon" className="h-7 w-7">
            <Link href="/admin/store">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back</span>
            </Link>
            </Button>
            <Avatar className="h-16 w-16 border">
            {store.logo ? (
                <AvatarImage src={store.logo} alt={store.storeName} />
            ) : null}
            <AvatarFallback>
                <StoreIcon className="h-8 w-8" />
            </AvatarFallback>
            </Avatar>
            <div>
                <h1 className="text-2xl font-bold tracking-tight font-headline">
                    {store.storeName}
                </h1>
            </div>
        </div>
        <div className="flex gap-2">
            <Button asChild variant="outline">
                <Link href={`/admin/store/${storeId}/edit`}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                </Link>
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
        </div>
      </div>
      
      <Card>
        <CardHeader>
            <CardTitle>Store Details</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6">
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Type</p>
                <Badge variant="secondary">{store.type}</Badge>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Contact No.</p>
                <p>{store.contactNo}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Email</p>
                <p>{store.email}</p>
            </div>
             <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Address</p>
                <p>{store.address}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Opening Date</p>
                <p>{store.openingDate || 'N/A'}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Status</p>
                 <Badge
                    variant={store.status === 'Active' ? 'default' : 'destructive'}
                    className={store.status === 'Active' ? 'bg-green-500' : ''}
                  >
                    {store.status}
                </Badge>
            </div>
             <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Description</p>
                <p>{store.description || 'No description available.'}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1">
                    {store.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                        {tag}
                        </Badge>
                    ))}
                     {store.tags.length === 0 && <p className="text-sm text-muted-foreground">N/A</p>}
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Table Locations</p>
                <div className="flex flex-wrap gap-1">
                    {store.tableLocations.map((loc) => (
                        <Badge key={loc} variant="outline">
                        {loc}
                        </Badge>
                    ))}
                    {store.tableLocations.length === 0 && <p className="text-sm text-muted-foreground">N/A</p>}
                </div>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">MOP Accepted</p>
                <div className="flex flex-wrap gap-1">
                    {store.mopAccepted.map((mop) => (
                        <Badge key={mop} variant="outline">
                        {mop}
                        </Badge>
                    ))}
                    {store.mopAccepted.length === 0 && <p className="text-sm text-muted-foreground">N/A</p>}
                </div>
            </div>
        </CardContent>
      </Card>

    </main>
  );
}

