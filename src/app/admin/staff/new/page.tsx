'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  addDoc,
  collection,
  onSnapshot,
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
import { ArrowLeft } from 'lucide-react';
import { Staff, Store } from '@/lib/types';


const initialStaffState: Omit<Staff, 'id'> = {
  assignedStore: '',
  fullName: '',
  address: '',
  email: '',
  contactNo: '',
  birthday: '',
  dateHired: '',
  position: '',
  rate: 0,
  employmentStatus: 'Active',
  notes: '',
  picture: '',
  encoder: '', // This should be set to the logged-in user
};

export default function NewStaffPage() {
  const [formData, setFormData] = useState<Omit<Staff, 'id'>>(initialStaffState);
  const [stores, setStores] = useState<Store[]>([]);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();

  useEffect(() => {
    if (firestore) {
      const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });
      return () => storesUnsubscribe();
    }
  }, [firestore]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
        if (name === 'rate') {
            const rate = parseFloat(value);
            return { ...prev, [name]: isNaN(rate) ? 0 : rate };
        }
        return { ...prev, [name]: value };
    });
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPictureFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage) return;

    let pictureUrl = '';
    if (pictureFile) {
      const pictureRef = ref(storage, `Shareat Hub/staff/${Date.now()}_${pictureFile.name}`);
      const snapshot = await uploadBytes(pictureRef, pictureFile);
      pictureUrl = await getDownloadURL(snapshot.ref);
    }
    
    const dataToSave = {
      ...formData,
      picture: pictureUrl,
    };

    try {
      await addDoc(collection(firestore, 'staff'), dataToSave);
      router.push('/admin/staff');
    } catch (error) {
      console.error('Error adding document: ', error);
    }
  };


  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="icon" className="h-7 w-7">
          <Link href="/admin/staff">
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">Back to Staff</span>
          </Link>
        </Button>
        <h1 className="text-lg font-semibold md:text-2xl font-headline">Add New Staff</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Staff Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" name="fullName" value={formData.fullName} onChange={handleInputChange} required />
              </div>
               <div className="space-y-2">
                <Label htmlFor="assignedStore">Assigned Store</Label>
                <Select name="assignedStore" onValueChange={(value) => handleSelectChange('assignedStore', value)} required>
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
                <Input id="birthday" name="birthday" value={formData.birthday} onChange={handleInputChange} placeholder="MM/DD/YYYY" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateHired">Date Hired</Label>
                <Input id="dateHired" name="dateHired" value={formData.dateHired} onChange={handleInputChange} placeholder="MM/DD/YYYY" />
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
              <div className="space-y-2">
                <Label htmlFor="picture">Picture</Label>
                <Input id="picture" name="picture" type="file" onChange={handleFileChange} />
              </div>
              <div className="md:col-span-3 space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" value={formData.notes} onChange={handleInputChange} />
              </div>
               <div className="space-y-2">
                <Label htmlFor="encoder">Encoder</Label>
                <Input id="encoder" name="encoder" value={formData.encoder} onChange={handleInputChange} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/staff">Cancel</Link>
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
