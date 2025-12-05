'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Store, ArrowLeft } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

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
  tags: ('Foodpanda' | 'Grab' | 'Dine in' | 'Take Out')[];
};

export default function StoreDetailPage({ params }: { params: { storeId: string } }) {
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const firestore = useFirestore();

  useEffect(() => {
    if (!firestore || !params.storeId) return;
    setLoading(true);
    const docRef = doc(firestore, 'stores', params.storeId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setStore({ id: docSnap.id, ...docSnap.data() } as Store);
      } else {
        setStore(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, params.storeId]);

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
      <div className="flex items-center gap-4">
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
            <Store className="h-8 w-8" />
          </AvatarFallback>
        </Avatar>
        <div>
            <h1 className="text-2xl font-bold tracking-tight font-headline">
                {store.storeName}
            </h1>
        </div>
      </div>
      
      <Card>
        <CardHeader>
            <CardTitle>Store Details</CardTitle>
            <CardDescription>{store.description || 'No description available.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6">
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Email</p>
                <p>{store.email}</p>
            </div>
             <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Contact No.</p>
                <p>{store.contactNo}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Address</p>
                <p>{store.address}</p>
            </div>
            <div className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground">Type</p>
                <Badge variant="secondary">{store.type}</Badge>
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
                <p className="text-sm font-medium text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1">
                    {store.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                        {tag}
                        </Badge>
                    ))}
                </div>
            </div>
        </CardContent>
      </Card>

    </main>
  );
}
