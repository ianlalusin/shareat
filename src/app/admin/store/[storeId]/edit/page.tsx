
'use client';

import { useState, useEffect } from 'react';
import { notFound, useRouter, useParams } from 'next/navigation';
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
  doc,
  updateDoc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Store as StoreIcon } from 'lucide-react';
import { Store, GListItem } from '@/lib/types';
import { formatAndValidateDate, revertToInputFormat } from '@/lib/utils';
import { TagsInput } from '@/components/ui/tags-input';


export default function EditStorePage() {
  const params = useParams();
  const storeId = params.storeId as string;
  const [formData, setFormData] = useState<Omit<Store, 'id'> | null>(null);
  const [loading, setLoading] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const [storeTags, setStoreTags] = useState<GListItem[]>([]);
  const [mopOptions, setMopOptions] = useState<GListItem[]>([]);
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();


  useEffect(() => {
    if (!firestore || !storeId) return;

    const fetchStore = async () => {
        const docRef = doc(firestore, 'stores', storeId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const storeData = docSnap.data() as Omit<Store, 'id'>;
            setFormData({ ...storeData, tags: storeData.tags || [], mopAccepted: storeData.mopAccepted || [], tableLocations: storeData.tableLocations || [] });
            if (storeData.logo) {
                setLogoPreview(storeData.logo);
            }
        } else {
            setFormData(null);
        }
        setLoading(false);
    }
    
    fetchStore();

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
    }

  }, [firestore, storeId]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => (prev ? { ...prev, [name]: value } : null));
     if (value === '') {
        setDateError(undefined);
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setFormData(prev => (prev ? { ...prev, [name]: formatted } : null));
    setDateError(error);
  };

  const handleDateFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const formattedValue = revertToInputFormat(value);
    setFormData(prev => (prev ? { ...prev, [name]: formattedValue } : null));
  }


  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (!formData) return;
    const { name, value } = e.target;
    setFormData((prev) => (prev ? { ...prev, [name]: value } : null));
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleSelectChange = (name: string, value: string) => {
     if (!formData) return;
     setFormData((prev) => (prev ? { ...prev, [name]: value } : null));
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
  };

  const handleTagChange = (tag: string) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const newTags = prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag];
      return { ...prev, tags: newTags };
    });
  };

  const handleMopChange = (mop: string) => {
    if (!formData) return;
    setFormData(prev => {
      if (!prev) return null;
      const newMops = prev.mopAccepted.includes(mop)
        ? prev.mopAccepted.filter(m => m !== mop)
        : [...prev.mopAccepted, mop];
      return { ...prev, mopAccepted: newMops };
    });
  };
  
  const handleTableLocationsChange = (newLocations: string[]) => {
    if (!formData) return;
    setFormData(prev => (prev ? { ...prev, tableLocations: newLocations } : null));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !formData || !storage || dateError) return;

    let logoUrl = formData.logo || '';
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
      const storeRef = doc(firestore, 'stores', storeId);
      await updateDoc(storeRef, dataToSave);
      router.push(`/admin/store/${storeId}`);
    } catch (error)      {
      console.error('Error saving document: ', error);
    }
  };

  if (loading) {
    return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <div className="flex items-center gap-4">
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-8 w-48" />
            </div>
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-6">
                     <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-10 w-full" /></div>
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
                <Link href={`/admin/store/${storeId}`}>
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Back</span>
                </Link>
            </Button>
            <h1 className="text-lg font-semibold md:text-2xl font-headline">
                Edit {formData.storeName}
            </h1>
        </div>
        <Card>
            <CardHeader>
                <CardTitle>Store Details</CardTitle>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
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
                      <Input id="openingDate" name="openingDate" value={formData.openingDate || ''} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" />
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
                        <div className="flex items-center gap-4">
                            <Avatar className="h-20 w-20 border">
                                {logoPreview ? <AvatarImage src={logoPreview} alt="Logo Preview" /> : null}
                                <AvatarFallback>
                                    <StoreIcon className="h-10 w-10" />
                                </AvatarFallback>
                            </Avatar>
                            <Input id="logo" name="logo" type="file" onChange={handleFileChange} className="max-w-xs" />
                        </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" name="description" value={formData.description || ''} onChange={handleInputChange} className="h-32" />
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
                    <div className="space-y-2">
                        <Label htmlFor="tableLocations">Table Locations</Label>
                        <TagsInput
                          id="tableLocations"
                          value={formData.tableLocations}
                          onChange={handleTableLocationsChange}
                          placeholder="Add locations..."
                        />
                    </div>
                     <div className="space-y-2">
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
                      <Link href={`/admin/store/${storeId}`}>Cancel</Link>
                    </Button>
                    <Button type="submit">Save Changes</Button>
                </div>
                </form>
            </CardContent>
        </Card>
    </main>
  );
}
