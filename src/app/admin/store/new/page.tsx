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
  query, 
  where,
  onSnapshot
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { GListItem, Store } from '@/lib/types';


const initialStoreState: Omit<Store, 'id'> = {
  storeName: '',
  type: 'resto',
  contactNo: '',
  email: '',
  address: '',
  description: '',
  status: 'Active',
  tags: [],
  logo: '',
  openingDate: '',
};

export default function NewStorePage() {
  const [formData, setFormData] = useState<Omit<Store, 'id'>>(initialStoreState);
  const [storeTags, setStoreTags] = useState<GListItem[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();


  useEffect(() => {
    if (firestore) {
      const tagsQuery = query(
        collection(firestore, 'lists'),
        where('category', '==', 'Store tags'),
        where('is_active', '==', true)
      );

      const unsubscribeTags = onSnapshot(tagsQuery, (snapshot) => {
        const tagsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GListItem[];
        setStoreTags(tagsData);
      });

      return () => {
        unsubscribeTags();
      }
    }
  }, [firestore]);


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

  const handleTagChange = (tagItem: string) => {
    setFormData((prev) => {
      const newTags = prev.tags.includes(tagItem)
        ? prev.tags.filter((t) => t !== tagItem)
        : [...prev.tags, tagItem];
      return { ...prev, tags: newTags };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage) return;

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
                    <div className="space-y-2">
                    <Label htmlFor="logo">Logo</Label>
                    <Input id="logo" name="logo" type="file" onChange={handleFileChange} />
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" name="address" value={formData.address} onChange={handleInputChange} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openingDate">Opening Date</Label>
                      <Input id="openingDate" name="openingDate" value={formData.openingDate} onChange={handleInputChange} placeholder="MM/DD/YYYY" />
                    </div>
                    <div className="col-span-2 space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" value={formData.description} onChange={handleInputChange} />
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
                    <div className="col-span-2 space-y-2">
                    <Label>Tags</Label>
                    <div className="flex flex-wrap gap-4">
                        {storeTags.map((tag) => (
                        <div key={tag.id} className="flex items-center space-x-2">
                            <Checkbox
                                id={`tag-${tag.item}`}
                                checked={formData.tags.includes(tag.item)}
                                onCheckedChange={() => handleTagChange(tag.item)}
                              />
                              <Label htmlFor={`tag-${tag.item}`} className="font-normal">{tag.item}</Label>
                        </div>
                        ))}
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
