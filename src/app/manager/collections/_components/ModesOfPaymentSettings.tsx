
"use client";

import { useState, useEffect, useMemo } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, where, doc, updateDoc, serverTimestamp, addDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, PlusCircle, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ModeOfPaymentEditDialog } from "./ModeOfPaymentEditDialog";
import { logActivity } from "@/lib/firebase/activity-log";
import { Checkbox } from "@/components/ui/checkbox";

export type ModeOfPayment = {
  id: string;
  name: string;
  type: "cash" | "card" | "online" | "other";
  sortOrder: number;
  isActive: boolean;
  hasRef: boolean;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
};

export function ModesOfPaymentSettings({ store }: { store: Store }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [modes, setModes] = useState<ModeOfPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMode, setEditingMode] = useState<ModeOfPayment | null>(null);

  useEffect(() => {
    // Guard against running the query if the store is not available.
    if (!store?.id) {
      setModes([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    const modesRef = collection(db, "stores", store.id, "storeModesOfPayment");
    const q = query(modesRef, where("isArchived", "==", false));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ModeOfPayment));
      // Perform sorting on the client
      data.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.name.localeCompare(b.name);
      });
      setModes(data);
      setIsLoading(false);
    }, (error) => {
      toast({ variant: "destructive", title: "Error", description: `Could not fetch payment modes: ${error.message}` });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [store?.id, toast]);

  const handleOpenDialog = (mode: ModeOfPayment | null = null) => {
    setEditingMode(mode);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: Partial<Omit<ModeOfPayment, 'id'>>, isCreating: boolean) => {
    if (!appUser) return;

    // Check for uniqueness
    const nameLower = data.name!.toLowerCase();
    const isDuplicate = modes.some(m => m.name.toLowerCase() === nameLower && m.id !== editingMode?.id);
    if (isDuplicate) {
      toast({ variant: "destructive", title: "Duplicate Name", description: "A mode of payment with this name already exists." });
      return;
    }

    try {
      if (isCreating) {
        const modesRef = collection(db, "stores", store.id, "storeModesOfPayment");
        await addDoc(modesRef, {
          ...data,
          type: "other", // Default type
          isArchived: false,
          createdBy: appUser.uid,
          updatedBy: appUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logActivity(appUser, "mop_created", `Created payment mode: ${data.name}`);
        toast({ title: "Mode of Payment Created" });
      } else if (editingMode) {
        const docRef = doc(db, "stores", store.id, "storeModesOfPayment", editingMode.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        await logActivity(appUser, "mop_updated", `Updated payment mode: ${data.name}`);
        toast({ title: "Mode of Payment Updated" });
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    }
  };

  const handleToggleActive = async (mode: ModeOfPayment) => {
    if (!appUser) return;
    const newStatus = !mode.isActive;
    const action = newStatus ? "Enable" : "Disable";
    
    if (!(await confirm({ title: `${action} ${mode.name}?`, confirmText: `Yes, ${action}` }))) return;

    const docRef = doc(db, "stores", store.id, "storeModesOfPayment", mode.id);
    await updateDoc(docRef, { isActive: newStatus, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
    toast({ title: "Status Updated" });
    await logActivity(appUser, `mop_${action.toLowerCase()}`, `${action}d payment mode: ${mode.name}`);
  };

  const handleArchive = async (mode: ModeOfPayment) => {
    if (!appUser) return;
    if (!(await confirm({
        title: `Archive ${mode.name}?`,
        description: "Archived items can be recovered later. They won't appear in cashier options.",
        confirmText: "Yes, Archive",
        destructive: true,
    }))) return;

    const docRef = doc(db, "stores", store.id, "storeModesOfPayment", mode.id);
    await updateDoc(docRef, { 
      isArchived: true, 
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid, 
      updatedAt: serverTimestamp() 
    });
    toast({ title: "Mode Archived" });
    await logActivity(appUser, 'mop_archived', `Archived payment mode: ${mode.name}`);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Modes of Payment</CardTitle>
          <CardDescription>Manage payment methods accepted in this store.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Mode
            </Button>
          </div>
          {modes.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requires Ref #</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modes.map(mode => (
                  <TableRow key={mode.id}>
                    <TableCell className="font-medium">{mode.name}</TableCell>
                    <TableCell><Badge variant={mode.isActive ? "default" : "outline"}>{mode.isActive ? "Enabled" : "Disabled"}</Badge></TableCell>
                    <TableCell><Checkbox checked={mode.hasRef} disabled /></TableCell>
                    <TableCell>{mode.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(mode)} className="mr-2">Edit</Button>
                      <Button variant={mode.isActive ? "secondary" : "default"} size="sm" onClick={() => handleToggleActive(mode)} className="mr-2">
                        {mode.isActive ? <PowerOff /> : <Power />}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleArchive(mode)}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No payment modes configured yet.</p>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <ModeOfPaymentEditDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSave}
          item={editingMode}
        />
      )}
      {Dialog}
    </>
  );
}
