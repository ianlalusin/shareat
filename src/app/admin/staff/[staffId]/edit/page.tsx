'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  onSnapshot
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useFirestore, useStorage } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { ArrowLeft, User } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Staff, Store } from '@/lib/types';
import { formatAndValidateDate, revertToInputFormat, autoformatDate } from '@/lib/utils';
import { parse, isValid, format } from 'date-fns';

export default function EditStaffPage() {
  const params = useParams();
  const staffId = params.staffId as string;
  const [formData, setFormData] = useState<Omit<Staff, 'id'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [stores, setStores] = useState<Store[]>([]);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const [dateErrors, setDateErrors] = useState<{ birthday?: string; dateHired?: string }>({});
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();

  useEffect(() => {
    if (!firestore || !staffId) return;

    const fetchStaff = async () => {
        const docRef = doc(firestore, 'staff', staffId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const staffData = docSnap.data() as Omit<Staff, 'id'>;
            
            const formattedData = {
              ...staffData,
              birthday: staffData.birthday ? formatAndValidateDate(staffData.birthday).formatted : '',
              dateHired: staffData.dateHired ? formatAndValidateDate(staffData.dateHired).formatted : ''
            }

            setFormData(formattedData);

            if (staffData.picture) {
                setPicturePreview(staffData.picture);
            }
        } else {
            setFormData(null); // Not found
        }
        setLoading(false);
    }
    
    fetchStaff();
    
    const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
      const storesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Store[];
      setStores(storesData);
    });

    return () => storesUnsubscribe();
  }, [firestore, staffId]);
  
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!formData) return;
    const { name, value } = e.target;
    const previousValue = formData[name as 'birthday' | 'dateHired'] || '';
    const updatedValue = autoformatDate(value, previousValue);
    
    setFormData((prev) => (prev ? { ...prev, [name]: updatedValue } : null));
    if (updatedValue === '') {
        setDateErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setFormData(prev => (prev ? { ...prev, [name]: formatted } : null));
    setDateErrors(prev => ({ ...prev, [name]: error }));
  };

  const handleDateFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const formattedValue = revertToInputFormat(value);
    setFormData(prev => (prev ? { ...prev, [name]: formattedValue } : null));
  }


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!formData) return;
    const { name, value } = e.target;
    setFormData((prev) => {
      if (!prev) return null;
      if (name === 'rate') {
          const rate = parseFloat(value);
          return { ...prev, [name]: isNaN(rate) ? 0 : rate };
      }
      return { ...prev, [name]: value };
    });
  };
  
  const handleSelectChange = (name: string, value: string) => {
    if (!formData) return;
    setFormData((prev) => (prev ? { ...prev, [name]: value } : null));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPictureFile(file);
      setPicturePreview(URL.createObjectURL(file));
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
  };


  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage || !formData || Object.values(dateErrors).some(e => e)) return;

    let pictureUrl = formData.picture || '';
    if (pictureFile) {
      const pictureRef = ref(storage, `Shareat Hub/staff/${Date.now()}_${pictureFile.name}`);
      const snapshot = await uploadBytes(pictureRef, pictureFile);
      pictureUrl = await getDownloadURL(snapshot.ref);
    }
    
    // Convert formatted date strings back to valid Date objects for Firestore
    const birthdayDate = formData.birthday ? parse(formData.birthday, 'MMMM dd, yyyy', new Date()) : null;
    const dateHiredDate = formData.dateHired ? parse(formData.dateHired, 'MMMM dd, yyyy', new Date()) : null;

    const dataToSave = {
      ...formData,
      picture: pictureUrl,
      birthday: isValid(birthdayDate) ? birthdayDate : null,
      dateHired: isValid(dateHiredDate) ? dateHiredDate : null,
    };

    try {
      const staffRef = doc(firestore, 'staff', staffId);
      await updateDoc(staffRef, dataToSave as Partial<Staff>);
      router.push(`/admin/staff/${staffId}`);
    } catch (error) {
      console.error('Error updating document: ', error);
    }
  };

  if (loading) {
    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
             <div className="flex items-center gap-4">
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-8 w-48" />
            </div>
            <Card><CardHeader><Skeleton className="h-6 w-32" /></CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-6">
                     <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                     <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                     <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
                </CardContent>
            </Card>
        </main>
    )
  }

  if (!formData) {
    return notFound();
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="icon" className="h-7 w-7">
          <Link href={`/admin/staff/${staffId}`}>
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back</span>
          </Link>
        </Button>
        <h1 className="text-lg font-semibold md:text-2xl font-headline">Edit {formData.fullName}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Staff Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-3 flex items-center gap-6">
                <Avatar className="h-24 w-24 border">
                    <AvatarImage src={picturePreview || undefined} alt="Staff picture" />
                    <AvatarFallback><User className="h-12 w-12" /></AvatarFallback>
                </Avatar>
                <div className="space-y-2 flex-grow">
                    <Label htmlFor="picture">Staff Picture</Label>
                    <Input id="picture" name="picture" type="file" onChange={handleFileChange} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" name="fullName" value={formData.fullName} onChange={handleInputChange} required />
              </div>
               <div className="space-y-2">
                <Label htmlFor="assignedStore">Assigned Store</Label>
                <Select name="assignedStore" value={formData.assignedStore} onValueChange={(value) => handleSelectChange('assignedStore', value)} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map(store => <SelectItem key={store.id} value={store.storeName}>{store.storeName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
               <div className="space-y-2">
                <Label htmlFor="position">Position</Label>
                <Input id="position" name="position" value={formData.position} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" value={formData.email} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactNo">Contact No.</Label>
                <Input id="contactNo" name="contactNo" value={formData.contactNo} onChange={handleInputChange} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input id="address" name="address" value={formData.address} onChange={handleInputChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthday">Birthday</Label>
                <Input id="birthday" name="birthday" value={formData.birthday || ''} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" maxLength={10} />
                {dateErrors.birthday && <p className="text-sm text-destructive">{dateErrors.birthday}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateHired">Date Hired</Label>
                <Input id="dateHired" name="dateHired" value={formData.dateHired || ''} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" maxLength={10} />
                {dateErrors.dateHired && <p className="text-sm text-destructive">{dateErrors.dateHired}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="rate">Rate</Label>
                <Input id="rate" name="rate" type="number" value={formData.rate} onChange={handleInputChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employmentStatus">Employment Status</Label>
                <Select name="employmentStatus" value={formData.employmentStatus} onValueChange={(value) => handleSelectChange('employmentStatus', value)} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                    <SelectItem value="Resigned">Resigned</SelectItem>
                    <SelectItem value="AWOL">AWOL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
               <div className="md:col-span-3 space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" value={formData.notes || ''} onChange={handleInputChange} />
              </div>
               <div className="space-y-2">
                <Label htmlFor="encoder">Encoder</Label>
                <Input id="encoder" name="encoder" value={formData.encoder} onChange={handleInputChange} disabled />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button type="button" variant="outline" asChild>
                <Link href={`/admin/staff/${staffId}`}>Cancel</Link>
              </Button>
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

    