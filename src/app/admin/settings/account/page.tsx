
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuthContext } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useAuth, useFirestore, useStorage } from '@/firebase';
import { signOut } from 'firebase/auth';
import { LogOut, Loader2 } from 'lucide-react';
import { doc, getDoc, onSnapshot, addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Staff, User, PendingAccount } from '@/lib/types';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageUpload } from '@/components/ui/image-upload';
import { formatAndValidateDate, autoformatDate } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function AccountPage() {
  const { user, devMode, setDevMode, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const auth = useAuth();
  const firestore = useFirestore();
  const storage = useStorage();

  const [staffData, setStaffData] = useState<Staff | null>(null);
  const [formData, setFormData] = useState<Partial<Staff>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();
  const [pendingUpdate, setPendingUpdate] = useState<PendingAccount | null>(null);

  useEffect(() => {
    if (authLoading || !firestore) return;
    if (devMode) {
      setLoading(false);
      return;
    }
    if (!user) return;

    const userRef = doc(firestore, 'users', user.uid);
    const unsubUser = onSnapshot(userRef, async (userDoc) => {
        if (!userDoc.exists()) {
            setLoading(false);
            return;
        }
        const userData = userDoc.data() as User;
        if (!userData.staffId) {
            setLoading(false);
            return;
        }

        const staffRef = doc(firestore, 'staff', userData.staffId);
        const staffDoc = await getDoc(staffRef);
        if (staffDoc.exists()) {
            const data = {id: staffDoc.id, ...staffDoc.data()} as Staff;
            setStaffData(data);
            const birthdayStr = data.birthday instanceof Timestamp ? formatAndValidateDate(data.birthday.toDate()).formatted : (data.birthday || '');
            setFormData({
                ...data,
                birthday: birthdayStr,
            });
        }
        setLoading(false);
    });

    const pendingUpdateRef = collection(firestore, 'pendingAccounts');
    const q = query(pendingUpdateRef, where('uid', '==', user.uid), where('type', '==', 'profile_update'), where('status', '==', 'pending'));
    const unsubPending = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
            setPendingUpdate(snapshot.docs[0].data() as PendingAccount);
        } else {
            setPendingUpdate(null);
        }
    });

    return () => {
        unsubUser();
        unsubPending();
    };

  }, [authLoading, firestore, user, devMode]);

  const handleLogout = async () => {
    if (devMode) {
      setDevMode(false);
    }
    if (user) {
      await signOut(auth);
    }
    router.push('/login');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const previousValue = (formData.birthday as string) || '';
    const updatedValue = autoformatDate(value, previousValue);
    setFormData((prev) => ({ ...prev, [name]: updatedValue }));
    if (updatedValue === '') {
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
  
  const handleFileChange = (file: File | null) => {
    setPictureFile(file);
    if(file){
        setFormData(prev => ({ ...prev, picture: URL.createObjectURL(file) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firestore || !user || !staffData) return;
    if (dateError) {
        toast({ title: "Invalid Date", description: dateError, variant: "destructive"});
        return;
    }

    setSaving(true);
    
    let pictureUrl = formData.picture || '';
    if (pictureFile) {
        try {
            const imageRef = ref(storage, `Shareat Hub/staff-updates/${Date.now()}_${pictureFile.name}`);
            const snapshot = await uploadBytes(imageRef, pictureFile);
            pictureUrl = await getDownloadURL(snapshot.ref);
        } catch (error) {
            toast({ title: "Image Upload Failed", variant: "destructive" });
            setSaving(false);
            return;
        }
    }
    
    const updatedFields: PendingAccount['updates'] = {};
    if (formData.fullName !== staffData.fullName) updatedFields.fullName = formData.fullName;
    if (formData.contactNo !== staffData.contactNo) updatedFields.contactNo = formData.contactNo;
    if (formData.address !== staffData.address) updatedFields.address = formData.address;
    if (formData.birthday !== (staffData.birthday instanceof Timestamp ? formatAndValidateDate(staffData.birthday.toDate()).formatted : staffData.birthday)) updatedFields.birthday = formData.birthday as string;
    if (pictureUrl && pictureUrl !== staffData.picture) updatedFields.picture = pictureUrl;

    if(Object.keys(updatedFields).length === 0){
        toast({ title: "No changes detected."});
        setSaving(false);
        return;
    }
    
    const pendingData: Omit<PendingAccount, 'id'> = {
        uid: user.uid,
        staffId: staffData.id,
        type: 'profile_update',
        email: user.email!,
        fullName: staffData.fullName,
        status: 'pending',
        createdAt: serverTimestamp() as Timestamp,
        expiresAt: new Timestamp(Date.now() / 1000 + 30 * 24 * 60 * 60, 0),
        updates: updatedFields
    };

    try {
        await addDoc(collection(firestore, 'pendingAccounts'), pendingData);
        toast({ title: "Update Submitted", description: "Your profile changes have been submitted for approval."});
        setSaving(false);
    } catch (error) {
        toast({ title: "Submission Failed", variant: "destructive" });
        setSaving(false);
    }
  };

  if (loading) {
      return (
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
            <Skeleton className="h-8 w-64" />
            <Card>
                <CardHeader>
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-4 w-full mt-2" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-40 w-full" />
                </CardContent>
            </Card>
        </main>
      )
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-lg font-semibold md:text-2xl font-headline">
        Account Information
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>My Profile</CardTitle>
          <CardDescription>
            {devMode ? 'You are in Developer Mode. Some features are simulated.' : 'Update your personal information. Changes require manager approval.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {pendingUpdate && (
                <Alert variant="info">
                    <AlertTitle>Pending Approval</AlertTitle>
                    <AlertDescription>You have a pending profile update request. You cannot submit new changes until it is reviewed.</AlertDescription>
                </Alert>
            )}
            
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={devMode ? 'developer@shareat.net' : user?.email || 'N/A'} readOnly disabled />
            </div>

             <div className="space-y-2">
                <Label>Profile Picture</Label>
                <ImageUpload 
                    imageUrl={formData.picture}
                    onFileChange={handleFileChange}
                    disabled={devMode || !!pendingUpdate || saving}
                />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input id="fullName" name="fullName" value={formData.fullName || ''} onChange={handleInputChange} disabled={devMode || !!pendingUpdate || saving} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="contactNo">Contact No.</Label>
                  <Input id="contactNo" name="contactNo" value={formData.contactNo || ''} onChange={handleInputChange} disabled={devMode || !!pendingUpdate || saving} />
                </div>
                 <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" value={formData.address || ''} onChange={handleInputChange} disabled={devMode || !!pendingUpdate || saving} />
                </div>
                 <div className="space-y-2">
                  <Label htmlFor="birthday">Birthday</Label>
                  <Input id="birthday" name="birthday" value={formData.birthday as string || ''} onChange={handleDateChange} onBlur={handleDateBlur} placeholder="MM/DD/YYYY" maxLength={10} disabled={devMode || !!pendingUpdate || saving}/>
                  {dateError && <p className="text-sm text-destructive">{dateError}</p>}
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                 <Button variant="destructive" onClick={handleLogout} className="order-2 sm:order-1">
                    <LogOut className="mr-2 h-4 w-4" />
                    Log Out
                 </Button>
                {!devMode && (
                    <Button type="submit" disabled={saving || !!pendingUpdate} className="order-1 sm:order-2">
                        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {saving ? 'Submitting...' : 'Save & Submit for Approval'}
                    </Button>
                )}
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
