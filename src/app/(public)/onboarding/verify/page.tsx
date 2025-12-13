
"use client";

import { useState } from "react";
import { doc, setDoc, updateDoc, serverTimestamp, Firestore, Timestamp } from "firebase/firestore";
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

// This component used to be ExistingStaffVerification, it is now a standalone page.
// The `staff` data will be passed via router state if this page is ever needed.
// For now, it's a placeholder to complete the routing structure.
export default function VerifyStaffPage() {
    const { user } = useAuthContext();
    const firestore = useFirestore();

    // In a real implementation, staff would be fetched or passed via state
    const [staff, setStaff] = useState<(Staff & { id: string }) | null>(null);

    const [fullName, setFullName] = useState(staff?.fullName ?? user?.displayName ?? "");
    const [phone, setPhone] = useState(staff?.contactNo ?? "");
    const [birthday, setBirthday] = useState(() => {
        if (!staff?.birthday) return '';
        if (staff.birthday instanceof Timestamp) {
            return formatAndValidateDate(staff.birthday.toDate()).formatted;
        }
        return staff.birthday as string;
    });
    const [dateError, setDateError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(dateError){
      alert('Please fix the birthday format.');
      return;
    }
    if (!staff || !user || !firestore) return;
    setSaving(true);
    try {
      const birthdayDate = birthday ? parse(birthday as string, 'MMMM dd, yyyy', new Date()) : null;

      const userRef = doc(firestore, "users", user.uid);
      await setDoc(userRef, {
        staffId: staff.id,
        email: user.email,
        displayName: fullName || user.displayName || staff.fullName,
        role: (staff.position || "staff").toLowerCase(),
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<User, 'id'>);

      const staffRef = doc(firestore, "staff", staff.id);
      await updateDoc(staffRef, {
        authUid: user.uid,
        fullName,
        contactNo: phone,
        birthday: isValid(birthdayDate) ? Timestamp.fromDate(birthdayDate) : null,
        lastLoginAt: serverTimestamp(),
      });
      
      // Force a reload to re-evaluate the auth context and guard
      window.location.reload();

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
            {staff ? (
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
                <p className="text-muted-foreground text-center">No staff record found to verify.</p>
            )}
        </CardContent>
      </Card>
    </div>
  );
}
