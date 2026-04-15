"use client";

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2, Trash2, UserCircle2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { hashPasscode } from "@/lib/server-profiles/passcode";
import { useConfirmDialog } from "@/components/global/confirm-dialog";

interface ProfileDoc {
  id: string;
  name: string;
  lastLoginAt?: any;
}

interface Props {
  storeId: string;
}

export function ServerProfilesManagerCard({ storeId }: Props) {
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [profiles, setProfiles] = useState<ProfileDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resetTarget, setResetTarget] = useState<ProfileDoc | null>(null);
  const [newPasscode, setNewPasscode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    const q = query(collection(db, "stores", storeId, "serverProfiles"), orderBy("name", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setProfiles(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setIsLoading(false);
    }, () => setIsLoading(false));
    return () => unsub();
  }, [storeId]);

  const handleDelete = async (p: ProfileDoc) => {
    if (!(await confirm({
      title: `Delete "${p.name}"?`,
      description: "This profile and its passcode will be permanently removed. The person can create a new profile on any tablet.",
      confirmText: "Delete",
    }))) return;
    try {
      await deleteDoc(doc(db, "stores", storeId, "serverProfiles", p.id));
      toast({ title: "Profile deleted", description: p.name });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Delete failed", description: err?.message });
    }
  };

  const handleResetSubmit = async () => {
    if (!resetTarget) return;
    if (!/^\d{6}$/.test(newPasscode)) {
      toast({ variant: "destructive", title: "Invalid passcode", description: "Must be exactly 6 digits." });
      return;
    }
    setSaving(true);
    try {
      const passcodeHash = await hashPasscode(storeId, newPasscode);
      await updateDoc(doc(db, "stores", storeId, "serverProfiles", resetTarget.id), {
        passcodeHash,
        passcodeResetAt: serverTimestamp(),
      });
      toast({ title: "Passcode reset", description: `${resetTarget.name} can sign in with the new 6-digit passcode.` });
      setResetTarget(null);
      setNewPasscode("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Reset failed", description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Server Profiles
          </CardTitle>
          <CardDescription>
            Device-local identities used on the Server Station. Reset a passcode if someone forgot theirs, or delete a profile to remove it from the switcher.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No server profiles yet for this store.</p>
          ) : (
            <ul className="divide-y border rounded-lg">
              {profiles.map((p) => (
                <li key={p.id} className="flex items-center gap-3 p-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <UserCircle2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setResetTarget(p); setNewPasscode(""); }}>
                    <KeyRound className="h-3.5 w-3.5 mr-1" /> Reset passcode
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(p)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!resetTarget} onOpenChange={(v) => { if (!v) { setResetTarget(null); setNewPasscode(""); } }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Reset passcode for {resetTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Enter a new 6-digit passcode. Share it with the server — they'll use it to sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New passcode</Label>
            <Input
              autoFocus
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={newPasscode}
              onChange={(e) => setNewPasscode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6 digits"
              className="text-center text-xl tracking-widest tabular-nums"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleResetSubmit} disabled={saving || newPasscode.length !== 6} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <KeyRound className="h-4 w-4 mr-2" />}
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ConfirmDialog}
    </>
  );
}
