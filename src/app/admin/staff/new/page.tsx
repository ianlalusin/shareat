

'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Staff, Store, StaffPosition } from '@/lib/types';
import { formatAndValidateDate, revertToInputFormat, autoformatDate } from '@/lib/utils';
import { parse, isValid } from 'date-fns';
import { ImageUpload } from '@/components/ui/image-upload';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';
import { useAuthContext } from '@/context/auth-context';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const positionOptions: StaffPosition[] = ['admin', 'manager', 'cashier', 'server', 'kitchen'];

const initialStaffState: Omit<Staff, 'id'> = {
  assignedStore: '',
  fullName: '',
  address: '',
  email: '',
  contactNo: '',
  birthday: '',
  dateHired: '',
  position: 'cashier',
  rate: 0,
  employmentStatus: 'Active',
  notes: '',
  picture: '',
  encoder: '',
  authUid: '',
  storeIds: [],
  defaultStoreId: null,
};

export default function NewStaffPage() {
  const [formData, setFormData] = useState<Omit<Staff, 'id'>>(initialStaffState);
  const [stores, setStores] = useState<Store[]>([]);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [dateErrors, setDateErrors] = useState<{ birthday?: string; dateHired?: string }>({});
  const firestore = useFirestore();
  const storage = useStorage();
  const { user: authUser, appUser, devMode } = useAuthContext();
  const router = useRouter();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  const filteredPositionOptions = useMemo(() => {
    if (appUser?.role === 'manager') {
      return positionOptions.filter(p => p !== 'admin' && p !== 'manager');
    }
    return positionOptions;
  }, [appUser]);

  useEffect(() => {
    if (firestore) {
      const storesUnsubscribe = onSnapshot(collection(firestore, 'stores'), (snapshot) => {
        const storesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Store[];
        setStores(storesData);
      });
      return () => storesUnsubscribe();
    }
  }, [firestore]);
  
  useEffect(() => {
    const editorName = authUser?.displayName || (devMode ? 'Dev User' : 'Unknown');
    setFormData(prev => ({...prev, encoder: editorName}));
  }, [authUser, devMode]);

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const previousValue = formData[name as 'birthday' | 'dateHired'] || '';
    const updatedValue = autoformatDate(value, previousValue);

    setFormData((prev) => ({ ...prev, [name]: updatedValue }));
     if (updatedValue === '') {
      setDateErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setFormData(prev => ({ ...prev, [name]: formatted }));
    setDateErrors(prev => ({ ...prev, [name]: error }));
  };

  const handleDateFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (!value) return;
    const formattedValue = revertToInputFormat(value as string);
    setFormData(prev => ({ ...prev, [name]: formattedValue }));
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
        if (name === 'rate') {
            const rate = parseFloat(value);
            return { ...prev, [name]: isNaN(rate) ? '' : rate };
        }
        if (name === 'authUid') {
          return { ...prev, authUid: value };
        }
        return { ...prev, [name]: value };
    });
  };
  
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (file: File | null) => {
    setPictureFile(file);
     if(file){
        setFormData(prev => ({...prev, picture: URL.createObjectURL(file)}))
    }
  };

  const handleStoreIdChange = (storeId: string) => {
    setFormData((prev) => {
      const currentIds = prev.storeIds || [];
      const newStoreIds = currentIds.includes(storeId)
        ? currentIds.filter(id => id !== storeId)
        : [...currentIds, storeId];
      
      let newDefaultId = prev.defaultStoreId;
      if (!newStoreIds.includes(newDefaultId || '')) {
        newDefaultId = newStoreIds[0] || null;
      }
      if (newStoreIds.length === 1) {
        newDefaultId = newStoreIds[0];
      }

      return { ...prev, storeIds: newStoreIds, defaultStoreId: newDefaultId };
    });
  };

  const getSelectedStoreNames = () => {
    if (!formData?.storeIds || formData.storeIds.length === 0) return "Select stores";
    if (formData.storeIds.length === stores.length) return "All stores selected";
    if (formData.storeIds.length > 2) return `${formData.storeIds.length} stores selected`;
    return stores
        .filter(s => formData.storeIds?.includes(s.id))
        .map(s => s.storeName)
        .join(', ');
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !storage || Object.values(dateErrors).some(e => e)) {
      if (Object.values(dateErrors).some(e => e)) {
        toast({
          variant: "destructive",
          title: "Invalid Date",
          description: "Please correct the date format (MM/DD/YYYY).",
        });
      }
      return;
    }
    
    if (!formData.storeIds || formData.storeIds.length === 0) {
      toast({ variant: 'destructive', title: 'Store required', description: 'Please assign at least one store.' });
      return;
    }

    let pictureUrl = '';
    if (pictureFile) {
      try {
        const pictureRef = ref(storage, `Shareat Hub/staff/${Date.now()}_${pictureFile.name}`);
        const snapshot = await uploadBytes(pictureRef, pictureFile);
        pictureUrl = await getDownloadURL(snapshot.ref);
      } catch (error) {
         toast({
          variant: "destructive",
          title: "Image upload failed",
          description: "Could not upload staff photo. Please try again.",
        });
      }
    }
    
    const dataToSave = {
      ...formData,
      picture: pictureUrl,
      birthday: formData.birthday ? parse(formData.birthday as string, 'MMMM dd, yyyy', new Date()) : null,
      dateHired: formData.dateHired ? parse(formData.dateHired as string, 'MMMM dd, yyyy', new Date()) : null,
      assignedStore: stores.find(s => s.id === formData.defaultStoreId)?.storeName || '',
    };

    try {
      await addDoc(collection(firestore, 'staff'), dataToSave);
      openSuccessModal();
      router.push('/admin/staff');
    } catch (error) {
       toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: "There was a problem saving the new staff member.",
      });
    }
  };

  const managerAllowedStores = useMemo(() => {
    if (appUser?.role === 'admin') return stores;
    if (appUser?.role === 'manager' && appUser.storeIds) {
      const managerStoreIds = new Set(appUser.storeIds);
      return stores.filter(s => managerStoreIds.has(s.id));
    }
    return [];
  }, [appUser, stores]);


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
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="storeIds">Assigned Stores</Label>
                  <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                          <span>{getSelectedStoreNames()}</span>
                          <ChevronDown className="h-4 w-4" />
                      </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                          <DropdownMenuItem onSelect={() => setFormData(prev => ({...prev, storeIds: managerAllowedStores.map(s => s.id)}))}>Select All</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setFormData(prev => ({...prev, storeIds: []}))}>Select None</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {managerAllowedStores.map(store => (
                              <DropdownMenuCheckboxItem
                                  key={store.id}
                                  checked={formData.storeIds?.includes(store.id)}
                                  onSelect={(e) => e.preventDefault()}
                                  onClick={() => handleStoreIdChange(store.id)}
                              >
                                  {store.storeName}
                              </DropdownMenuCheckboxItem>
                          ))}
                      </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="defaultStoreId">Default Store</Label>
                    <Select name="defaultStoreId" value={formData.defaultStoreId || ''} onValueChange={(value) => handleSelectChange('defaultStoreId', value)} required disabled={!formData.storeIds || formData.storeIds.length === 0}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select default store"/>
                        </SelectTrigger>
                        <SelectContent>
                            {stores.filter(s => formData.storeIds?.includes(s.id)).map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.storeName}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                 </div>
              </div>
               <div className="space-y-2">
                <Label htmlFor="position">Position (Role)</Label>
                 <Select name="position" value={formData.position} onValueChange={(value) => handleSelectChange('position', value as StaffPosition)} required>
                    <SelectTrigger>
                        <SelectValue placeholder="Select a position" />
                    </SelectTrigger>
                    <SelectContent>
                        {filteredPositionOptions.map(pos => <SelectItem key={pos} value={pos} className="capitalize">{pos}</SelectItem>)}
                    </SelectContent>
                </Select>
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
                <Input id="birthday" name="birthday" value={formData.birthday as string} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" maxLength={10} />
                {dateErrors.birthday && <p className="text-sm text-destructive">{dateErrors.birthday}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dateHired">Date Hired</Label>
                <Input id="dateHired" name="dateHired" value={formData.dateHired as string} onChange={handleDateChange} onBlur={handleDateBlur} onFocus={handleDateFocus} placeholder="MM/DD/YYYY" maxLength={10} />
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
              <div className="space-y-2">
                <Label>Picture</Label>
                <ImageUpload imageUrl={formData.picture} onFileChange={handleFileChange} />
              </div>
              <div className="md:col-span-3 space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" value={formData.notes} onChange={handleInputChange} />
              </div>
              <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="authUid">Auth UID</Label>
                    <Input 
                      id="authUid" 
                      name="authUid" 
                      value={formData.authUid || ''} 
                      onChange={handleInputChange}
                      placeholder="Enter Firebase Auth UID manually"
                      disabled={!devMode && !authUser}
                    />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="encoder">Encoder</Label>
                  <Input id="encoder" name="encoder" value={formData.encoder} readOnly disabled />
                </div>
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

