
"use client";

import { useState, FormEvent, useEffect, useMemo } from "react";
import {
  doc,
  setDoc,
  updateDoc,
  collection,
  serverTimestamp,
  Firestore,
  onSnapshot,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { parse } from 'date-fns';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Store, AppUser, PendingAccount, Staff } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";

type StaffDoc = Staff & { id: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: PendingAccount;
  staffList: StaffDoc[];
  firestore: Firestore;
}

export function ApprovePendingAccountDialog({
  open,
  onOpenChange,
  pending,
  staffList,
  firestore,
}: Props) {
  const { user, devMode } = useAuthContext();
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [stores, setStores] = useState<Store[]>([]);
  const { toast } = useToast();

  const [saving, setSaving] = useState(false);
  const [originalStaffData, setOriginalStaffData] = useState<Staff | null>(null);

  const selectedStaff = useMemo(
    () => staffList.find(s => s.id === selectedStaffId) ?? null,
    [staffList, selectedStaffId]
  );
  
  const unlinkedStaff = useMemo(
    () => staffList.filter(s => !s.authUid && s.employmentStatus === 'Active'),
    [staffList]
  );

  useEffect(() => {
    // Reset state when pending user changes
    setSaving(false);
    setSelectedStaffId("");
    if(pending.type === 'profile_update') {
        const fetchOriginal = async () => {
            if(pending.staffId) {
                const staffDoc = await getDoc(doc(firestore, 'staff', pending.staffId));
                if(staffDoc.exists()) setOriginalStaffData(staffDoc.data() as Staff);
            }
        };
        fetchOriginal();
    } else {
        setOriginalStaffData(null);
    }
  }, [pending, firestore]);
  
  useEffect(() => {
    if(!firestore) return;
    const unsub = onSnapshot(collection(firestore, "stores"), (snap) => {
        const storesData = snap.docs.map(d => ({id: d.id, ...d.data()}) as Store);
        setStores(storesData);
    });
    return () => unsub();
  }, [firestore]);
  

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!firestore || !user) return;

    if (pending.type === 'profile_update') {
        await handleApproveUpdate();
        return;
    }

    if (!pending.uid || !pending.email) {
      toast({ variant: 'destructive', title: 'Error', description: 'Invalid pending account data.' });
      return;
    }

    if (!selectedStaff) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select a staff member to link.' });
      return;
    }

    setSaving(true);
    const editorName = user.displayName || (devMode ? 'Dev User' : 'System');

    const storeForStaff = stores.find(s => s.storeName === selectedStaff.assignedStore);

    try {
      const userRef = doc(firestore, "users", pending.uid);
      await setDoc(userRef, {
        staffId: selectedStaff.id,
        email: selectedStaff.email,
        displayName: selectedStaff.fullName,
        role: selectedStaff.position,
        storeID: storeForStaff?.id || '',
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<AppUser, 'id'>);

      const staffRef = doc(firestore, "staff", selectedStaff.id);
      await updateDoc(staffRef, {
        authUid: pending.uid,
        lastLoginAt: serverTimestamp(),
        encoder: editorName,
      });

      const pendingRef = doc(firestore, "pendingAccounts", pending.id);
      await updateDoc(pendingRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: editorName,
      });

      toast({
        title: "Account Approved",
        description: `${selectedStaff.fullName}'s account is now active and linked.`
      });
      onOpenChange(false);
    } catch (err) {
      console.error("Error approving pending account", err);
      toast({
        variant: 'destructive',
        title: 'Approval Failed',
        description: 'Failed to approve request. Please try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApproveUpdate = async () => {
    if (!firestore || !user || !pending.staffId || !pending.updates) {
      toast({ variant: 'destructive', title: 'Error', description: 'Invalid update request data.' });
      return;
    }
    setSaving(true);
    try {
        const staffRef = doc(firestore, 'staff', pending.staffId);
        
        const updatesToApply = { ...pending.updates };
        if (updatesToApply.birthday) {
            updatesToApply.birthday = Timestamp.fromDate(parse(updatesToApply.birthday, 'MMMM dd, yyyy', new Date()));
        }

        await updateDoc(staffRef, {
            ...updatesToApply,
            encoder: user.displayName || user.email,
        });

        const pendingRef = doc(firestore, "pendingAccounts", pending.id);
        await updateDoc(pendingRef, {
            status: "approved",
            approvedAt: serverTimestamp(),
            approvedBy: user.displayName || user.email,
        });

        toast({ title: 'Update Approved', description: `Profile for ${pending.fullName} has been updated.` });
        onOpenChange(false);
    } catch (err) {
        console.error("Error approving update", err);
        toast({ variant: 'destructive', title: 'Approval Failed', description: 'Failed to approve update.' });
    } finally {
        setSaving(false);
    }
  };
  
  const getDisplayValue = (value: any) => {
    if (value instanceof Timestamp) {
        return value.toDate().toLocaleDateString();
    }
    return value || 'Not set';
  }

  const renderUpdateContent = () => (
    <Card className="p-4 space-y-3">
        <p className="text-sm font-medium">Proposed Changes</p>
        <ScrollArea className="max-h-60 rounded-md border">
            <div className="p-4 space-y-4">
                {Object.entries(pending.updates || {}).map(([key, value]) => (
                    <div key={key}>
                        <Label className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                        <div className="grid grid-cols-2 gap-2 items-center">
                            <p className="text-sm text-muted-foreground line-through">
                                {getDisplayValue((originalStaffData as any)?.[key])}
                            </p>
                             <p className="text-sm font-semibold text-green-600">
                                {getDisplayValue(value)}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </ScrollArea>
        <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleApproveUpdate} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : null}
                Approve Changes
            </Button>
        </div>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Review request from {pending.fullName}</DialogTitle>
          <DialogDescription>
            {pending.type === 'new_account' 
                ? "Approve this request by linking it to an existing, unlinked staff profile."
                : "Review the requested profile changes and approve them."}
          </DialogDescription>
        </DialogHeader>

        {pending.type === 'profile_update' ? renderUpdateContent() : (
            <form onSubmit={handleSubmit} className="space-y-4">
                <ScrollArea className="max-h-[calc(80vh-10rem)] pr-4">
                    <div className="space-y-4">
                        <Card className="p-4 space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm font-medium">{pending.fullName}</p>
                                <p className="text-xs text-muted-foreground">
                                {pending.email}
                                </p>
                            </div>
                            <div className="flex gap-2 items-center justify-end">
                                <Badge variant="outline">Pending</Badge>
                            </div>
                            </div>
                        </Card>

                        <Card className="p-4 space-y-3">
                            <p className="text-sm font-medium">Select Staff Profile to Link</p>
                            <p className="text-xs text-muted-foreground">
                                Choose the active staff record that corresponds to this user account.
                            </p>
                            <Select value={selectedStaffId} onValueChange={setSelectedStaffId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select an active, unlinked staff member..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unlinkedStaff.map(s => (
                                        <SelectItem key={s.id} value={s.id}>{s.fullName} ({s.position})</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            
                            {selectedStaff && (
                                <div className="p-3 border bg-muted/50 rounded-lg text-sm space-y-2">
                                    <div>
                                        <Label className="text-xs">Role</Label>
                                        <Input value={selectedStaff.position} readOnly className="h-8 bg-background"/>
                                    </div>
                                    <div>
                                        <Label className="text-xs">Store</Label>
                                        <Input value={selectedStaff.assignedStore} readOnly className="h-8 bg-background"/>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>
                </ScrollArea>

                <div className="flex items-end justify-end gap-2 pt-4 border-t">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={saving || !selectedStaffId}
                    >
                        {saving ? <Loader2 className="animate-spin mr-2" /> : null}
                        {saving ? "Linking…" : "Approve & Link"}
                    </Button>
                </div>
            </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
