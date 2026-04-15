"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LogOut, Plus, UserCircle2, Loader2 } from "lucide-react";
import { hashPasscode } from "@/lib/server-profiles/passcode";
import { PasscodePad } from "./PasscodePad";
import { CreateServerProfileModal } from "./CreateServerProfileModal";

interface ProfileDoc {
  id: string;
  name: string;
  passcodeHash: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId: string;
  currentProfileId: string | null;
  onSignIn: (profileId: string, name: string) => void;
  onSignOut: () => void;
}

export function ServerProfileSwitcher({ open, onOpenChange, storeId, currentProfileId, onSignIn, onSignOut }: Props) {
  const [profiles, setProfiles] = useState<ProfileDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<ProfileDoc | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [shake, setShake] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setShake(false);
    }
  }, [open]);

  useEffect(() => {
    if (!storeId) return;
    const q = query(collection(db, "stores", storeId, "serverProfiles"), orderBy("name", "asc"));
    setIsLoading(true);
    const unsub = onSnapshot(q, (snap) => {
      setProfiles(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      setIsLoading(false);
    }, () => setIsLoading(false));
    return () => unsub();
  }, [storeId]);

  const handlePasscodeComplete = async (passcode: string) => {
    if (!selected) return;
    setVerifying(true);
    try {
      const hash = await hashPasscode(storeId, passcode);
      if (hash !== selected.passcodeHash) {
        setShake(true);
        setTimeout(() => setShake(false), 450);
        setResetToken(t => t + 1);
        return;
      }
      try {
        await updateDoc(doc(db, "stores", storeId, "serverProfiles", selected.id), {
          lastLoginAt: serverTimestamp(),
        });
      } catch { /* non-critical */ }
      onSignIn(selected.id, selected.name);
      onOpenChange(false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCircle2 className="h-5 w-5 text-primary" />
              {selected ? `Enter passcode for ${selected.name}` : "Who's using this tablet?"}
            </DialogTitle>
            <DialogDescription>
              {selected
                ? "6-digit passcode."
                : "Tap your name, or create a new profile."}
            </DialogDescription>
          </DialogHeader>

          {!selected && (
            <div className="space-y-2">
              {isLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
                </p>
              ) : profiles.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No profiles yet on this store.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto -mx-6 px-6 space-y-1">
                  {profiles.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelected(p); setResetToken(t => t + 1); }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-accent transition text-left"
                    >
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="font-medium">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> Create new profile
              </Button>

              {currentProfileId && (
                <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={() => { onSignOut(); onOpenChange(false); }}>
                  <LogOut className="h-4 w-4 mr-1" /> Sign out
                </Button>
              )}
            </div>
          )}

          {selected && (
            <div className="space-y-3">
              <PasscodePad
                onComplete={handlePasscodeComplete}
                resetToken={resetToken}
                shake={shake}
                isProcessing={verifying}
              />
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelected(null)} disabled={verifying}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to profiles
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CreateServerProfileModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        storeId={storeId}
        onCreated={(id, name) => {
          setCreateOpen(false);
          onSignIn(id, name);
          onOpenChange(false);
        }}
      />
    </>
  );
}
