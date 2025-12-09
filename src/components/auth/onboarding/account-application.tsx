
"use client";

import { useState } from "react";
import {
  addDoc,
  collection,
  serverTimestamp,
  Firestore,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { autoformatDate, formatAndValidateDate, revertToInputFormat } from "@/lib/utils";

interface Props {
  firebaseUser: FirebaseUser;
  firestore: Firestore;
  onSubmitted: () => void;
}

export function AccountApplicationScreen({
  firebaseUser,
  firestore,
  onSubmitted,
}: Props) {
  const [fullName, setFullName] = useState(firebaseUser.displayName ?? "");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState<string | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dateError) {
      alert('Please fix the birthday format.');
      return;
    }
    if (!firebaseUser.email) {
      alert("Your account has no email. Please contact the admin.");
      return;
    }
    setSaving(true);
    try {
      const expiresAt = new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000
      ); // 30 days

      await addDoc(collection(firestore, "pendingAccounts"), {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        fullName,
        phone,
        birthday: birthday || null,
        notes,
        status: "pending",
        createdAt: serverTimestamp(),
        expiresAt,
      });

      onSubmitted();
    } catch (err) {
      console.error("Error submitting account application", err);
      alert("Something went wrong. Please inform your manager.");
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
            <CardTitle>Request access</CardTitle>
            <CardDescription>
            We couldn't find your staff profile. Please submit your
            basic information so your manager can approve your account.
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

            <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Applying as cashier at Lipa branch"
                />
            </div>

             <CardFooter className="p-0 pt-2 flex justify-end">
                <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                    {saving ? "Submitting…" : "Submit request"}
                </Button>
            </CardFooter>
            </form>
        </CardContent>
      </Card>
    </div>
  );
}
