

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import Link from 'next/link';
import { doc, onSnapshot, deleteDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { useFirestore, useStorage } from '@/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Pencil, Trash2, User, Upload } from 'lucide-react';
import { Staff } from '@/lib/types';
import { cn, formatCurrency } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { useSuccessModal } from '@/store/use-success-modal';

export default function StaffDetailPage() {
  const params = useParams();
  const staffId = params.staffId as string;
  const [staff, setStaff] = useState<Staff | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { openSuccessModal } = useSuccessModal();

  useEffect(() => {
    if (!firestore || !staffId) return;
    setLoading(true);
    const docRef = doc(firestore, 'staff', staffId);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        setStaff({ id: docSnap.id, ...docSnap.data() } as Staff);
      } else {
        setStaff(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, staffId]);
  
  const handleDelete = async () => {
    if (!firestore || !staffId) return;
    if (window.confirm('Are you sure you want to delete this staff member?')) {
        try {
            await deleteDoc(doc(firestore, 'staff', staffId));
            openSuccessModal();
            router.push('/admin/staff');
        } catch (error) {
            console.error("Error deleting document: ", error);
        }
    }
  };
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0] || !firestore || !storage || !staffId) {
        return;
    }
    const file = e.target.files[0];
    
    setIsUploading(true);
    try {
      const pictureRef = ref(storage, `Shareat Hub/staff/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(pictureRef, file);
      const pictureUrl = await getDownloadURL(snapshot.ref);

      const staffRef = doc(firestore, 'staff', staffId);
      await updateDoc(staffRef, { picture: pictureUrl });
      
      setIsPhotoModalOpen(false);
      openSuccessModal();

    } catch (error) {
      console.error('Error uploading new photo: ', error);
      alert('Failed to upload photo. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const formatDate = (dateValue: string | Timestamp | undefined) => {
    if (!dateValue) return 'N/A';
    if (dateValue instanceof Timestamp) {
      return format(dateValue.toDate(), 'MMMM dd, yyyy');
    }
    // It might already be a string from older data, return as is.
    return dateValue;
  }


  if (loading) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-7 w-7" />
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
          </div>
        </div>
        <Card><CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-6">
             <div className="space-y-1"><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-48" /></div>
             <div className="space-y-1"><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-48" /></div>
             <div className="space-y-1"><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-48" /></div>
             <div className="space-y-1"><Skeleton className="h-4 w-24" /><Skeleton className="h-5 w-48" /></div>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!staff) {
    return notFound();
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="icon" className="h-7 w-7">
            <Link href="/admin/staff">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back</span>
            </Link>
          </Button>
          <Dialog open={isPhotoModalOpen} onOpenChange={setIsPhotoModalOpen}>
            <DialogTrigger asChild>
                <Avatar className="h-16 w-16 border cursor-pointer">
                    <AvatarImage src={staff.picture} alt={staff.fullName} />
                    <AvatarFallback><User className="h-8 w-8" /></AvatarFallback>
                </Avatar>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{staff.fullName}&apos;s Photo</DialogTitle>
                </DialogHeader>
                <div className="flex items-center justify-center p-4">
                    <img src={staff.picture || '/placeholder-user.jpg'} alt={staff.fullName} className="max-h-80 w-auto rounded-md object-contain" />
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                    <Input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                    <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                        <Upload className="mr-2 h-4 w-4" />
                        {isUploading ? 'Uploading...' : 'Upload New Photo'}
                    </Button>
                </DialogFooter>
            </DialogContent>
          </Dialog>
          <h1 className="text-2xl font-bold tracking-tight font-headline">
            {staff.fullName}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/staff/${staffId}/edit`}>
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
          <CardTitle>Staff Information</CardTitle>
          <CardDescription>Encoded by: {staff.encoder || 'N/A'}</CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-x-6 gap-y-8">
          <InfoItem label="Full Name" value={staff.fullName} />
          <InfoItem label="Assigned Store" value={staff.assignedStore} />
          <InfoItem label="Position" value={staff.position} />
          <InfoItem label="Email" value={staff.email} />
          <InfoItem label="Contact No." value={staff.contactNo} />
          <InfoItem label="Address" value={staff.address} />
          <InfoItem label="Birthday" value={formatDate(staff.birthday)} />
          <InfoItem label="Date Hired" value={formatDate(staff.dateHired)} />
          <InfoItem label="Rate" value={formatCurrency(staff.rate)} />
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Employment Status</p>
            <Badge variant={staff.employmentStatus === 'Active' ? 'default' : 'secondary'} className={staff.employmentStatus === 'Active' ? 'bg-green-500' : ''}>
                {staff.employmentStatus}
            </Badge>
          </div>
          <InfoItem label="Notes" value={staff.notes} className="md:col-span-3" />
        </CardContent>
      </Card>
    </main>
  );
}

function InfoItem({ label, value, className }: { label: string; value?: string | number; className?: string}) {
    return (
        <div className={cn("space-y-1", className)}>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p>{value || 'N/A'}</p>
        </div>
    )
}

    
    
