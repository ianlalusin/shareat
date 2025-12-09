
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

interface Props {
  staff: Staff & { id: string };
  firebaseUser: FirebaseUser;
  firestore: Firestore;
  onComplete: () => void;
}

export function ExistingStaffVerification({
  staff,
  firebaseUser,
  firestore,
  onComplete,
}: Props) {
  const [fullName, setFullName] = useState(staff.fullName ?? "");
  const [phone, setPhone] = useState(staff.contactNo ?? "");
  const [birthday, setBirthday] = useState(staff.birthday instanceof Timestamp ? staff.birthday.toDate().toISOString().split('T')[0] : (staff.birthday as string) ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const userRef = doc(firestore, "users", firebaseUser.uid);
      await setDoc(userRef, {
        staffId: staff.id,
        email: firebaseUser.email,
        displayName: fullName || firebaseUser.displayName || staff.fullName,
        role: (staff.position || "staff").toLowerCase(),
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<User, 'id'>);

      const staffRef = doc(firestore, "staff", staff.id);
      await updateDoc(staffRef, {
        authUid: firebaseUser.uid,
        fullName,
        contactNo: phone,
        birthday: birthday ? Timestamp.fromDate(new Date(birthday)) : null,
        lastLoginAt: serverTimestamp(),
      });

      onComplete();
    } catch (err) {
      console.error("Error completing existing staff onboarding", err);
      alert("Something went wrong. Please contact your manager.");
    } finally {
      setSaving(false);
    }
  };

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
                <Input value={firebaseUser.email ?? ""} disabled />
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
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                />
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                {saving ? "Saving…" : "Confirm & continue"}
                </Button>
            </div>
            </form>
        </CardContent>
      </Card>
    </div>
  );
}
