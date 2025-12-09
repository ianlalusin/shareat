
"use client";

import { useState } from "react";
import {
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Firestore,
} from "firebase/firestore";
import type { User as FirebaseUser } from "firebase/auth";
import type { Staff, User } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface Props {
  staffList: (Staff & { id: string })[];
  firebaseUser: FirebaseUser;
  firestore: Firestore;
  onComplete: () => void;
}

export function DuplicateStaffResolution({
  staffList,
  firebaseUser,
  firestore,
  onComplete,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const chosen = staffList.find((s) => s.id === selectedId);
      if (!chosen) return;

      const userRef = doc(firestore, "users", firebaseUser.uid);
      await setDoc(userRef, {
        staffId: chosen.id,
        email: firebaseUser.email,
        displayName: chosen.fullName,
        role: (chosen.position || "staff").toLowerCase(),
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<User, 'id'>);

      const chosenRef = doc(firestore, "staff", chosen.id);
      await updateDoc(chosenRef, {
        authUid: firebaseUser.uid,
        lastLoginAt: serverTimestamp(),
      });

      const others = staffList.filter((s) => s.id !== chosen.id);
      await Promise.all(
        others.map((s) =>
          updateDoc(doc(firestore, "staff", s.id), {
            duplicateOf: chosen.id,
            employmentStatus: 'Inactive'
          })
        )
      );

      onComplete();
    } catch (err) {
      console.error("Error resolving duplicate staff", err);
      alert("Something went wrong while resolving duplicates.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-xl">
        <CardHeader>
            <CardTitle>Choose your staff profile</CardTitle>
            <CardDescription>
            We found multiple staff profiles using your email. Please choose the one
            that matches your current position. The others will be marked for review
            by your manager.
            </CardDescription>
        </CardHeader>
        <CardContent>
            <RadioGroup
            value={selectedId ?? undefined}
            onValueChange={(val) => setSelectedId(val)}
            className="space-y-3"
            >
            {staffList.map((s) => (
                <Label
                key={s.id}
                htmlFor={s.id}
                className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-accent has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:border-primary"
                >
                <RadioGroupItem value={s.id} id={s.id} className="mt-1" />
                <div className="space-y-1">
                    <p className="font-semibold">{s.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                    Position: {s.position || "—"}
                    <br />
                    Store: {s.assignedStore ?? "Not set"}
                    <br />
                    Status: {s.employmentStatus}
                    </p>
                </div>
                </Label>
            ))}
            </RadioGroup>
        </CardContent>
        <CardFooter className="flex justify-end">
            <Button onClick={handleConfirm} disabled={!selectedId || saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                {saving ? "Saving…" : "Confirm & continue"}
            </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
