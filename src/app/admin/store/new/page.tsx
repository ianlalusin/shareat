'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from "date-fns";
import { Calendar as CalendarIcon, ArrowLeft } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';


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
  tags: string[];
  openingDate?: Date | string;
};

type GListItem = {
  id: string;
  item: string;
  category: string;
  is_active: boolean;
};

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
  openingDate: new Date(),
};

export default function NewStorePage() {
  const [formData, setFormData] = useState<Omit<Store, 'id'>>(initialStoreState);
  const [storeTags, setStoreTags] = useState<GListItem[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const firestore = useFirestore();
  const storage = useStorage();
  const router = useRouter();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [tempDate, setTempDate] = useState<Date | undefined>(new Date());

  const yearRange = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return {
      fromYear: 1990,
      toYear: currentYear,
    };
  }, []);

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

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData((prev) => ({...prev, openingDate: date}));
    }
  }

  const confirmDate = () => {
    handleDateChange(tempDate);
    setIsDatePickerOpen(false);
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
    
    const openingDate = formData.openingDate
      ? (formData.openingDate instanceof Date ? formData.openingDate.toISOString() : formData.openingDate)
      : null;

    const dataToSave = {
      ...formData,
      logo: logoUrl,
      openingDate: openingDate
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
                    <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                        <PopoverTrigger asChild>
                        <Button
                            variant={"outline"}
                            className={cn(
                            "w-full justify-start text-left font-normal",
                            !formData.openingDate && "text-muted-foreground"
                            )}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {formData.openingDate ? format(new Date(formData.openingDate), "PPP") : <span>Pick a date</span>}
                        </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                        <Calendar
                            mode="single"
                            selected={tempDate}
                            onSelect={setTempDate}
                            captionLayout="dropdown-buttons"
                            fromYear={yearRange.fromYear}
                            toYear={yearRange.toYear}
                            initialFocus
                        />
                        <div className="p-2 border-t border-border">
                            <Button size="sm" className="w-full" onClick={confirmDate}>Confirm</Button>
                        </div>
                        </PopoverContent>
                    </Popover>
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
