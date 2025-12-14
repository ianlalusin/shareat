
"use client";

import { useState, useEffect } from "react";
import { doc, setDoc, updateDoc, serverTimestamp, Firestore, Timestamp, getDocs, collection, query, where } from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import type { Staff, User } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { formatAndValidateDate, revertToInputFormat, autoformatDate } from '@/lib/utils';
import { parse, isValid } from 'date-fns';
import { useAuthContext } from "@/context/auth-context";
import { useFirestore } from "@/firebase";
import { useOnboardingStore } from "@/store/use-onboarding-store";
import { useRouter } from "next/navigation";

// This component used to be ExistingStaffVerification, it is now a standalone page.
export default function VerifyStaffPage() {
    const { user } = useAuthContext();
    const firestore = useFirestore();
    const router = useRouter();
    const { staffToVerify } = useOnboardingStore();

    const [fullName, setFullName] = useState("");
    const [phone, setPhone] = useState("");
    const [birthday, setBirthday] = useState("");
    const [dateError, setDateError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!staffToVerify) {
        // If there's no staff data (e.g., page refresh), maybe redirect
        // For now, it will just show the "not found" message.
        // A more robust solution might redirect to the start of the flow.
        return;
      }
      setFullName(staffToVerify.fullName || user?.displayName || "");
      setPhone(staffToVerify.contactNo || "");
      const bday = staffToVerify.birthday instanceof Timestamp ? formatAndValidateDate(staffToVerify.birthday.toDate()).formatted : staffToVerify.birthday as string;
      setBirthday(bday || '');
    }, [staffToVerify, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(dateError){
      alert('Please fix the birthday format.');
      return;
    }
    if (!staffToVerify || !user || !firestore) return;
    setSaving(true);
    try {
      const birthdayDate = birthday ? parse(birthday as string, 'MMMM dd, yyyy', new Date()) : null;

      const userRef = doc(firestore, "users", user.uid);
      
      const storeQuery = query(collection(firestore, 'stores'), where('storeName', '==', staffToVerify.assignedStore));
      const storeSnap = await getDocs(storeQuery);
      const storeId = storeSnap.empty ? '' : storeSnap.docs[0].id;
      
      await setDoc(userRef, {
        staffId: staffToVerify.id,
        email: user.email,
        displayName: fullName || user.displayName || staffToVerify.fullName,
        role: (staffToVerify.position || "staff").toLowerCase(),
        storeId,
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<User, 'id'>);

      const staffRef = doc(firestore, "staff", staffToVerify.id);
      await updateDoc(staffRef, {
        authUid: user.uid,
        fullName,
        contactNo: phone,
        birthday: isValid(birthdayDate) ? Timestamp.fromDate(birthdayDate) : null,
        lastLoginAt: serverTimestamp(),
      });
      
      // Re-evaluate auth state and guard without a full page reload
      router.replace('/');
      router.refresh();

    } catch (err) {
      console.error("Error completing existing staff onboarding", err);
      alert("Something went wrong. Please contact your manager.");
    } finally {
      setSaving(false);
    }
  };
  
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = e.target;
    const updatedValue = autoformatDate(value, birthday);
    setBirthday(updatedValue);
     if (updatedValue === '') {
      setDateError(undefined);
    }
  };

  const handleDateBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const { value } = e.target;
    if (!value) return;
    const { formatted, error } = formatAndValidateDate(value);
    setBirthday(formatted);
    setDateError(error);
  };
  
  const handleDateFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const { value } = e.target;
    if (!value) return;
    const formattedValue = revertToInputFormat(value);
    setBirthday(formattedValue);
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
            <CardTitle>Verify your staff details</CardTitle>
            <CardDescription>
            We found your staff record in the system. Please confirm your personal
            information. Operational details are managed by your manager.
            </CardDescription>
        </CardHeader>
        <CardContent>
            {staffToVerify ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="fullName">Full name</Label>
                    <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    />
                </div>

                <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={user?.email ?? ""} disabled />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input
                        id="phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="09xx xxx xxxx"
                    />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="birthday">Birthday</Label>
                        <Input 
                            id="birthday"
                            type="text" 
                            value={birthday}
                            onChange={handleDateChange}
                            onBlur={handleDateBlur}
                            onFocus={handleDateFocus}
                            placeholder="MM/DD/YYYY"
                            maxLength={10}
                        />
                        {dateError && <p className="text-sm text-destructive">{dateError}</p>}
                    </div>
                </div>

                <CardFooter className="p-0 pt-2 flex justify-end">
                    <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {saving ? "Saving…" : "Confirm & continue"}
                    </Button>
                </CardFooter>
                </form>
            ) : (
                <p className="text-muted-foreground text-center">No staff record found to verify. You may have refreshed the page. Please sign out and sign back in.</p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
