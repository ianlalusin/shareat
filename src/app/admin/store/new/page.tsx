'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from "lucide-react";
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
import { useFirestore, useStorage } from '@/firebase';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Store, GListItem } from '@/lib/types';
import { formatAndValidateDate, revertToInputFormat } from '@/lib/utils';


const initialStoreState: Omit<Store, 'id'> = {
  storeName: '',
  type: 'resto',
  contactNo: '',
  email: '',
  address: '',
  description: '',
  status: 'Active',
  tags: [],
  mopAccepted: [],
  logo: '',
  openingDate: '',
};

export default function NewStorePage() {
  const [formData, setFormData] = useState<Omit<Store, 'id'>>(initialStoreState);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const [storeTags, setStoreTags] = useState<GListItem[]>([]);
  const [mopOptions, setMopOptions] = useState<GListItem[]>([]);
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();

  useEffect(() => {
    if (firestore) {
      const tagsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'store tags'),
        where('is_active', '==', true)
      );
      const tagsUnsubscribe = onSnapshot(tagsQuery, (snapshot) => {
        const tagsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setStoreTags(tagsData);
      });
      
      const mopQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'MOP'),
        where('is_active', '==', true)
      );
      const mopUnsubscribe = onSnapshot(mopQuery, (snapshot) => {
        const mopData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setMopOptions(mopData);
      });

      return () => {
        tagsUnsubscribe();
        mopUnsubscribe();
      };
    }
  }, [firestore]);


  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (value === '') {
        setDateError(undefined);
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setFormData(prev => ({ ...prev, [name]: formatted }));
    setDateError(error);
  };

  const handleDateFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const formattedValue = revertToInputFormat(value);
    setFormData(prev => ({ ...prev, [name]: formattedValue }));
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setLogoFile(e.target.files[0]);
    }
  };

  const handleSelectChange = (name: string, value: string) => {
     setFormData((prev) => ({ ...prev, [name]: value }));
  }

  const handleTagChange = (tag: string) => {
    setFormData(prev => {
      const newTags = prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag];
      return { ...prev, tags: newTags };
    });
  };

  const handleMopChange = (mop: string) => {
    setFormData(prev => {
      const newMops = prev.mopAccepted.includes(mop)
        ? prev.mopAccepted.filter(m => m !== mop)
        : [...prev.mopAccepted, mop];
      return { ...prev, mopAccepted: newMops };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage || dateError) return;

    let logoUrl = '';
    if (logoFile) {
      const logoRef = ref(storage, `Shareat Hub/logos/${Date.now()}_${logoFile.name}`);
      const snapshot = await uploadBytes(logoRef, logoFile);
      logoUrl = await getDownloadURL(snapshot.ref);
    }
    
    const dataToSave = {
      ...formData,
      logo: logoUrl,
    };

    try {
      await addDoc(collection(firestore, 'stores'), dataToSave);
      router.push('/admin/store');
    } catch (error) {
      console.error('Error saving document: ', error);
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
        <div className="flex items-center gap-4">
            <Button asChild variant="outline" size="icon" className="h-7 w-7">
                <Link href="/admin/store">
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back to Stores</span>
                </Link>
            </Button>
            <h1 className="text-lg font-semibold md:text-2xl font-headline">
                Add New Store
            </h1>
        </div>
        <Card>
            <CardHeader>
                <CardTitle>New Store Details</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <div className="md:col-span-2 space-y-2">
                      <Label htmlFor="address">Address</Label>
                      <Input id="address" name="address" value={formData.address} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openingDate">Opening Date</Label>
                      <Input id="openingDate" name="openingDate" value={formData.openingDate} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" />
                      {dateError && <p className="text-sm text-destructive">{dateError}</p>}
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
                    <div className="md:col-span-2 space-y-2">
                      <Label htmlFor="logo">Logo</Label>
                      <Input id="logo" name="logo" type="file" onChange={handleFileChange} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} className="h-32" />
                    </div>
                    <div className="space-y-2">
                        <Label>Tags</Label>
                        <div className="flex flex-wrap gap-2 rounded-lg border p-4 h-32 overflow-auto">
                            {storeTags.map((tag) => (
                            <Button
                                key={tag.id}
                                type="button"
                                variant={formData.tags.includes(tag.item) ? 'default' : 'outline'}
                                onClick={() => handleTagChange(tag.item)}
                            >
                                {tag.item}
                            </Button>
                            ))}
                             {storeTags.length === 0 && <p className='text-sm text-muted-foreground'>No tags found. Add them in G.List.</p>}
                        </div>
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <Label>MOP Accepted</Label>
                        <div className="flex flex-wrap gap-2 rounded-lg border p-4 h-32 overflow-auto">
                            {mopOptions.map((mop) => (
                            <Button
                                key={mop.id}
                                type="button"
                                variant={formData.mopAccepted.includes(mop.item) ? 'default' : 'outline'}
                                onClick={() => handleMopChange(mop.item)}
                            >
                                {mop.item}
                            </Button>
                            ))}
                             {mopOptions.length === 0 && <p className='text-sm text-muted-foreground'>No MOPs found. Add them in G.List.</p>}
                        </div>
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <Button type="button" variant="outline" asChild>
                      <Link href="/admin/store">Cancel</Link>
                    </Button>
                    <Button type="submit">Save</Button>
                </div>
                </form>
            </CardContent>
        </Card>
    </main>
  );
}
