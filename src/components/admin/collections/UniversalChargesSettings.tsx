"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  updateDoc,
  serverTimestamp,
  addDoc,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, PlusCircle, Power, PowerOff, Trash2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { UniversalChargeEditDialog } from "./UniversalChargeEditDialog";
import { rebuildStoreConfigsSafely } from "@/lib/manager/dataManagement";
import type { GlobalCharge, Store } from "@/lib/types";

function formatChargeScope(scope: GlobalCharge["scope"] | string | undefined): string {
  if (!scope) return "Bill";
  const arr = Array.isArray(scope) ? scope : [scope];
  if (arr.length === 0) return "Bill";
  return arr.map(s => (s === "item" ? "Item" : "Bill")).join(", ");
}

export function UniversalChargesSettings({ stores }: { stores: Store[] }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [charges, setCharges] = useState<GlobalCharge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalCharge | null>(null);

  useEffect(() => {
    setIsLoading(true);
    const q = query(collection(db, "globalCharges"), where("isArchived", "==", false));
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalCharge));
        data.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
        setCharges(data);
        setIsLoading(false);
      },
      err => {
        toast({ variant: "destructive", title: "Error", description: `Could not fetch universal charges: ${err.message}` });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [toast]);

  const storeNameById = (id: string) => stores.find(s => s.id === id)?.name || id;

  const handleOpenDialog = (item: GlobalCharge | null = null) => {
    setEditing(item);
    setIsDialogOpen(true);
  };

  const syncAndToast = async (storeIds: string[]) => {
    if (storeIds.length === 0) return;
    const results = await rebuildStoreConfigsSafely(db, storeIds);
    const failed = results.filter(r => !r.ok);
    if (failed.length > 0) {
      toast({
        variant: "destructive",
        title: "Store sync incomplete",
        description: `Could not sync ${failed.length} of ${results.length} store(s). POS may show stale data until the next manual sync.`,
      });
    }
  };

  const handleSave = async (data: Partial<Omit<GlobalCharge, "id">>, isCreating: boolean) => {
    if (!appUser) return;

    const nameLower = data.name!.toLowerCase();
    const isDuplicate = charges.some(c => c.name.toLowerCase() === nameLower && c.id !== editing?.id);
    if (isDuplicate) {
      toast({ variant: "destructive", title: "Duplicate Name", description: "A universal charge with this name already exists." });
      return;
    }

    try {
      const prevStoreIds = editing?.applicableStoreIds || [];
      const nextStoreIds = (data.applicableStoreIds as string[] | undefined) || [];
      const affected = Array.from(new Set([...prevStoreIds, ...nextStoreIds]));

      if (isCreating) {
        const ref = collection(db, "globalCharges");
        const newDoc = {
          ...data,
          isArchived: false,
          createdBy: appUser.uid,
          updatedBy: appUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        const docRef = await addDoc(ref, newDoc);
        await updateDoc(docRef, { id: docRef.id });
        toast({ title: "Universal Charge Created" });
      } else if (editing) {
        const docRef = doc(db, "globalCharges", editing.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        toast({ title: "Universal Charge Updated" });
      }
      setIsDialogOpen(false);
      await syncAndToast(affected);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save Failed", description: e.message });
    }
  };

  const handleToggleEnabled = async (item: GlobalCharge) => {
    if (!appUser) return;
    const newStatus = !item.isEnabled;
    const action = newStatus ? "Enable" : "Disable";
    if (!(await confirm({ title: `${action} ${item.name}?`, confirmText: `Yes, ${action}` }))) return;
    const ref = doc(db, "globalCharges", item.id);
    await updateDoc(ref, { isEnabled: newStatus, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
    toast({ title: "Status Updated" });
    await syncAndToast(item.applicableStoreIds || []);
  };

  const handleArchive = async (item: GlobalCharge) => {
    if (!appUser) return;
    if (!(await confirm({
      title: `Archive ${item.name}?`,
      description: "Archived universal charges are removed from all assigned stores.",
      confirmText: "Yes, Archive",
      destructive: true,
    }))) return;
    const ref = doc(db, "globalCharges", item.id);
    await updateDoc(ref, {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp(),
    });
    toast({ title: "Universal Charge Archived" });
    await syncAndToast(item.applicableStoreIds || []);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> Universal Charges</CardTitle>
          <CardDescription>
            Platform-wide charges assigned to specific stores. Managers see these as read-only on their collections page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Universal Charge
            </Button>
          </div>
          {charges.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Applies To</TableHead>
                  <TableHead>Stores</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="capitalize">{c.type}</TableCell>
                    <TableCell>{c.type === "percent" ? `${c.value}%` : `₱${c.value.toFixed(2)}`}</TableCell>
                    <TableCell>{formatChargeScope(c.scope)}</TableCell>
                    <TableCell className="capitalize">{c.appliesTo}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(c.applicableStoreIds || []).length === 0
                          ? <span className="text-xs text-muted-foreground">None</span>
                          : (c.applicableStoreIds || []).map(id => (
                              <Badge key={id} variant="secondary" className="text-xs">{storeNameById(id)}</Badge>
                            ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.isEnabled ? "default" : "outline"}>
                        {c.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{c.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(c)} className="mr-2">Edit</Button>
                      <Button
                        variant={c.isEnabled ? "secondary" : "default"}
                        size="sm"
                        onClick={() => handleToggleEnabled(c)}
                        className="mr-2"
                      >
                        {c.isEnabled ? <PowerOff /> : <Power />}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleArchive(c)}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No universal charges yet.</p>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <UniversalChargeEditDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSave}
          item={editing}
          stores={stores}
        />
      )}
      {Dialog}
    </>
  );
}
