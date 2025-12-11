
"use client";

import { useState, FormEvent, useEffect } from "react";
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
import { Store, User, PendingAccount, Staff } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";

type StaffDoc = Staff & { id: string };

const ROLE_OPTIONS = [
  { value: "cashier", label: "Cashier" },
  { value: "kitchen", label: "Kitchen Staff" },
  { value: "refill", label: "Refill Staff" },
  { value: "manager", label: "Store Manager" },
  { value: "admin", label: "Admin" },
];

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
  const [mode, setMode] = useState<"attach" | "create">("attach");
  const [selectedStaffId, setSelectedStaffId] = useState<string | "">("");
  const [role, setRole] = useState<string>("cashier");
  const [stores, setStores] = useState<Store[]>([]);
  const { toast } = useToast();

  // For create mode
  const [fullName, setFullName] = useState(pending.fullName);
  const [phone, setPhone] = useState(pending.phone ?? "");
  const [birthday, setBirthday] = useState(pending.birthday ?? "");
  const [address, setAddress] = useState(pending.address ?? "");
  const [position, setPosition] = useState("Cashier");
  const [assignedStore, setAssignedStore] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("Active");
  const [saving, setSaving] = useState(false);
  const [originalStaffData, setOriginalStaffData] = useState<Staff | null>(null);

  useEffect(() => {
    // Reset state when pending user changes
    setFullName(pending.fullName);
    setPhone(pending.phone ?? "");
    setBirthday(pending.birthday ?? "");
    setAddress(pending.address ?? "");
    setSaving(false);
    setSelectedStaffId("");
    setRole("cashier");
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

    setSaving(true);
    const editorName = user.displayName || (devMode ? 'Dev User' : 'System');

    try {
      let staffIdToUse: string;
      let staffName: string = pending.fullName;

      if (mode === "attach") {
        const id = selectedStaffId;
        if (!id) {
          toast({ variant: 'destructive', title: 'Error', description: 'Select a staff record to attach this account to.' });
          setSaving(false);
          return;
        }

        staffIdToUse = id;
        const attachedStaff = staffList.find(s => s.id === id);
        staffName = attachedStaff?.fullName || pending.fullName;

        const staffRef = doc(firestore, "staff", staffIdToUse);
        await updateDoc(staffRef, {
          authUid: pending.uid,
          lastLoginAt: serverTimestamp(),
          encoder: editorName,
        });
      } else {
        const staffRef = doc(collection(firestore, "staff"));
        staffIdToUse = staffRef.id;
        const birthdayDate = birthday ? parse(birthday, 'MMMM dd, yyyy', new Date()) : null;

        await setDoc(staffRef, {
          fullName,
          email: pending.email,
          contactNo: phone,
          address,
          birthday: birthdayDate,
          position,
          assignedStore,
          employmentStatus,
          dateHired: serverTimestamp(),
          authUid: pending.uid,
          encoder: 'System (Self-registered)',
        });
        staffName = fullName;
      }

      const userRef = doc(firestore, "users", pending.uid);
      await setDoc(userRef, {
        staffId: staffIdToUse,
        email: pending.email,
        displayName: staffName,
        role,
        status: "active",
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
      } as Omit<User, 'id'>);

      const pendingRef = doc(firestore, "pendingAccounts", pending.id);
      await updateDoc(pendingRef, {
        status: "approved",
        approvedAt: serverTimestamp(),
        approvedBy: editorName,
      });

      toast({
        title: "Account Approved",
        description: `${staffName}'s account is now active.`
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh]" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Review request from {pending.fullName}</DialogTitle>
          <DialogDescription>
            {pending.type === 'new_account' 
                ? "Approve this request by attaching it to an existing staff profile or creating a new one." 
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
                    <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
                    <div>
                        <span className="block font-medium text-foreground text-xs">
                        Phone
                        </span>
                        <span>{pending.phone || "—"}</span>
                    </div>
                    <div>
                        <span className="block font-medium text-foreground text-xs">
                        Birthday
                        </span>
                        <span>{pending.birthday || "—"}</span>
                    </div>
                    <div className="md:col-span-1">
                        <span className="block font-medium text-foreground text-xs">
                        Notes
                        </span>
                        <span className="line-clamp-2">
                        {pending.notes || "—"}
                        </span>
                    </div>
                    </div>
                </Card>

                <div className="grid gap-3 md:grid-cols-2">
                    <button
                    type="button"
                    onClick={() => setMode("attach")}
                    className={`flex flex-col items-start rounded-md border p-3 text-left text-sm transition hover:bg-muted ${
                        mode === "attach" ? "border-primary bg-muted" : ""
                    }`}
                    >
                    <span className="font-medium">Attach to existing staff</span>
                    <span className="text-xs text-muted-foreground">
                        Use an existing staff profile already configured in the system.
                    </span>
                    </button>

                    <button
                    type="button"
                    onClick={() => setMode("create")}
                    className={`flex flex-col items-start rounded-md border p-3 text-left text-sm transition hover:bg-muted ${
                        mode === "create" ? "border-primary bg-muted" : ""
                    }`}
                    >
                    <span className="font-medium">Create new staff record</span>
                    <span className="text-xs text-muted-foreground">
                        Add this person as a new staff member and link their account.
                    </span>
                    </button>
                </div>

                {mode === "attach" && (
                    <Card className="p-4 space-y-3">
                    <p className="text-sm font-medium">Select staff profile</p>
                    <p className="text-xs text-muted-foreground">
                        We’ll link this login to the chosen staff record.
                    </p>

                    <ScrollArea className="max-h-40 rounded-md border">
                        <div className="divide-y">
                        {staffList.length === 0 && (
                            <div className="p-3 text-xs text-muted-foreground">
                            No active staff records found. Switch to{" "}
                            <span className="font-medium">Create new staff</span>.
                            </div>
                        )}

                        {staffList.map((s) => (
                            <label
                            key={s.id}
                            className={`flex cursor-pointer items-start gap-3 p-3 text-xs hover:bg-muted ${
                                selectedStaffId === s.id
                                ? "bg-muted/70 border-l-2 border-l-primary"
                                : ""
                            }`}
                            >
                            <input
                                type="radio"
                                name="staffChoice"
                                value={s.id}
                                checked={selectedStaffId === s.id}
                                onChange={() => setSelectedStaffId(s.id)}
                                className="mt-1"
                            />
                            <div className="space-y-1">
                                <p className="font-medium text-sm">{s.fullName}</p>
                                <p className="text-muted-foreground">
                                {s.position || "No position"} ·{" "}
                                {s.assignedStore || "No store"}
                                </p>
                                <p className="text-muted-foreground">
                                {s.email}
                                </p>
                            </div>
                            </label>
                        ))}
                        </div>
                    </ScrollArea>
                    </Card>
                )}

                {mode === "create" && (
                    <Card className="p-4 space-y-4">
                    <p className="text-sm font-medium">New staff details</p>

                    <div className="space-y-2">
                        <Label htmlFor="fullName">Full name</Label>
                        <Input
                        id="fullName"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required={mode === "create"}
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                        <Label>Email</Label>
                        <Input value={pending.email} disabled />
                        </div>
                        <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                            id="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <Input
                            id="address"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                        <Label htmlFor="birthday">Birthday</Label>
                        <Input
                            id="birthday"
                            value={birthday}
                            onChange={(e) => setBirthday(e.target.value)}
                            placeholder="MM/DD/YYYY"
                        />
                        </div>
                        <div className="space-y-2">
                        <Label htmlFor="position">Position</Label>
                        <Input
                            id="position"
                            value={position}
                            onChange={(e) => setPosition(e.target.value)}
                            placeholder="e.g. Cashier, Kitchen Staff"
                            required={mode === "create"}
                        />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="storeId">Assigned store</Label>
                            <Select value={assignedStore} onValueChange={setAssignedStore} required={mode === 'create'}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a store" />
                                </SelectTrigger>
                                <SelectContent>
                                    {stores.map(store => (
                                        <SelectItem key={store.id} value={store.storeName}>{store.storeName}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="employmentStatus">Employment Status</Label>
                            <Select value={employmentStatus} onValueChange={setEmploymentStatus} required={mode === 'create'}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Probation">Probation</SelectItem>
                                <SelectItem value="Inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    </Card>
                )}
                </div>
                </ScrollArea>

                <div className="grid gap-4 md:grid-cols-[1.2fr_1fr] pt-4 border-t">
                    <div className="space-y-2">
                    <Label htmlFor="role">System role</Label>
                    <Select value={role} onValueChange={setRole}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                        {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                            {r.label}
                        </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Controls which sections of the app this account can access.
                    </p>
                    </div>

                    <div className="flex items-end justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={saving || (mode === "attach" && !selectedStaffId)}
                    >
                        {saving ? <Loader2 className="animate-spin" /> : null}
                        {saving ? "Saving…" : "Approve & link"}
                    </Button>
                    </div>
                </div>
            </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
