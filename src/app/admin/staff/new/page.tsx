'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Staff, Store } from '@/lib/types';


const initialStaffState: Omit<Staff, 'id'> = {
  assignedStore: '',
  fullName: '',
  address: '',
  email: '',
  contactNo: '',
  birthday: new Date(),
  dateHired: new Date(),
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
    setFormData((prev) => ({ ...prev, [name]: name === 'rate' ? (parseFloat(value) || 0) : value }));
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDateChange = (name: string, date: Date | undefined) => {
    if (date) {
      setFormData((prev) => ({ ...prev, [name]: date }));
    }
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
      birthday: formData.birthday ? format(new Date(formData.birthday), "yyyy-MM-dd") : null,
      dateHired: formData.dateHired ? format(new Date(formData.dateHired), "yyyy-MM-dd") : null,
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
                 <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        variant={"outline"}
                        className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.birthday && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.birthday ? format(new Date(formData.birthday), "PPP") : <span>Pick a date</span>}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={new Date(formData.birthday)}
                        onSelect={(date) => handleDateChange('birthday', date)}
                        initialFocus
                    />
                    </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateHired">Date Hired</Label>
                 <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        variant={"outline"}
                        className={cn(
                        "w-full justify-start text-left font-normal",
                        !formData.dateHired && "text-muted-foreground"
                        )}
                    >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.dateHired ? format(new Date(formData.dateHired), "PPP") : <span>Pick a date</span>}
                    </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                    <Calendar
                        mode="single"
                        selected={new Date(formData.dateHired)}
                        onSelect={(date) => handleDateChange('dateHired', date)}
                        initialFocus
                    />
                    </PopoverContent>
                </Popover>
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
