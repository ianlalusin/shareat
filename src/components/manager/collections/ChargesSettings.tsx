
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp, addDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, PlusCircle, Power, PowerOff, Trash2, Globe, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChargeEditDialog } from "./ChargeEditDialog";
import { subscribeApplicableGlobalCharges } from "@/lib/collections/globalCollections";
import type { Store, Charge, GlobalCharge } from "@/lib/types";

function formatChargeScope(scope: Charge["scope"] | string | undefined): string {
  if (!scope) return "Bill";
  const arr = Array.isArray(scope) ? scope : [scope];
  if (arr.length === 0) return "Bill";
  return arr.map(s => (s === "item" ? "Item" : "Bill")).join(", ");
}

export function ChargesSettings({ store }: { store: Store }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [storeCharges, setStoreCharges] = useState<Charge[]>([]);
  const [globalCharges, setGlobalCharges] = useState<GlobalCharge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCharge, setEditingCharge] = useState<Charge | null>(null);

  useEffect(() => {
    if (!store?.id) {
      setStoreCharges([]);
      setGlobalCharges([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const chargesRef = collection(db, "stores", store.id, "storeCharges");
    const q = query(chargesRef, where("isArchived", "==", false));

    const unsubStore = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Charge));
      setStoreCharges(data);
      setIsLoading(false);
    }, (error) => {
      toast({ variant: "destructive", title: "Error", description: `Could not fetch charges: ${error.message}` });
      setIsLoading(false);
    });

    const unsubGlobal = subscribeApplicableGlobalCharges(
      db,
      store.id,
      (items) => setGlobalCharges(items),
      (err) => console.error("Global charges subscribe error:", err)
    );

    return () => {
      unsubStore();
      unsubGlobal();
    };
  }, [store?.id, toast]);

  const charges = useMemo<Charge[]>(() => {
    const taggedStore: Charge[] = storeCharges.map(c => ({ ...c, source: "store" as const }));
    const taggedGlobal: Charge[] = globalCharges.map(g => ({
      id: g.id,
      name: g.name,
      type: g.type,
      value: g.value,
      appliesTo: g.appliesTo,
      scope: g.scope,
      isEnabled: g.isEnabled,
      sortOrder: g.sortOrder,
      isArchived: g.isArchived,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      createdBy: g.createdBy,
      updatedBy: g.updatedBy,
      source: "global" as const,
    }));
    const merged = [...taggedStore, ...taggedGlobal];
    merged.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    return merged;
  }, [storeCharges, globalCharges]);

  const handleOpenDialog = (charge: Charge | null = null) => {
    setEditingCharge(charge);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: Partial<Omit<Charge, 'id'>>, isCreating: boolean) => {
    if (!appUser) return;

    const nameLower = data.name!.toLowerCase();
    const isDuplicate = storeCharges.some(c => c.name.toLowerCase() === nameLower && c.id !== editingCharge?.id);
    if (isDuplicate) {
      toast({ variant: "destructive", title: "Duplicate Name", description: "A charge with this name already exists." });
      return;
    }

    try {
      if (isCreating) {
        const chargesRef = collection(db, "stores", store.id, "storeCharges");
        const docRef = await addDoc(chargesRef, {
          ...data,
          isArchived: false,
          createdBy: appUser.uid,
          updatedBy: appUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(docRef, { id: docRef.id });
        toast({ title: "Charge Created" });
      } else if (editingCharge) {
        const docRef = doc(db, "stores", store.id, "storeCharges", editingCharge.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        toast({ title: "Charge Updated" });
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    }
  };

  const handleToggleEnabled = async (charge: Charge) => {
    if (!appUser) return;
    const newStatus = !charge.isEnabled;
    const action = newStatus ? "Enable" : "Disable";

    if (!(await confirm({ title: `${action} ${charge.name}?`, confirmText: `Yes, ${action}` }))) return;

    const docRef = doc(db, "stores", store.id, "storeCharges", charge.id);
    await updateDoc(docRef, { isEnabled: newStatus, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
    toast({ title: "Status Updated" });
  };

  const handleArchive = async (charge: Charge) => {
    if (!appUser) return;
    if (!(await confirm({
        title: `Archive ${charge.name}?`,
        description: "Archived charges can be recovered later.",
        confirmText: "Yes, Archive",
        destructive: true,
    }))) return;

    const docRef = doc(db, "stores", store.id, "storeCharges", charge.id);
    await updateDoc(docRef, {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp()
    });
    toast({ title: "Charge Archived" });
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
          <CardDescription>
            Manage service charges and other fees for this store. Entries marked <Badge variant="outline" className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Universal</Badge> are platform-wide and managed by an admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Charge
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
                  <TableHead>Status</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map(charge => {
                  const isGlobal = charge.source === "global";
                  const isSuspended = !!charge.adminSuspended;
                  return (
                    <TableRow key={`${charge.source ?? "store"}-${charge.id}`} className={isSuspended ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {charge.name}
                          {isGlobal && (
                            <Badge variant="outline" className="inline-flex items-center gap-1">
                              <Globe className="h-3 w-3" /> Universal
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize">{charge.type}</TableCell>
                      <TableCell>{charge.type === 'percent' ? `${charge.value}%` : `₱${charge.value.toFixed(2)}`}</TableCell>
                      <TableCell>{formatChargeScope(charge.scope)}</TableCell>
                      <TableCell className="space-x-1">
                        <Badge variant={charge.isEnabled ? "default" : "outline"}>{charge.isEnabled ? "Enabled" : "Disabled"}</Badge>
                        {isSuspended && (
                          <Badge variant="destructive" className="inline-flex items-center gap-1">
                            <Ban className="h-3 w-3" /> Suspended by admin
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{charge.sortOrder}</TableCell>
                      <TableCell className="text-right">
                        {isGlobal ? (
                          <span className="text-xs text-muted-foreground">Managed by admin</span>
                        ) : (
                          <>
                            <Button variant="outline" size="sm" onClick={() => handleOpenDialog(charge)} className="mr-2">Edit</Button>
                            <Button
                              variant={charge.isEnabled ? "secondary" : "default"}
                              size="sm"
                              onClick={() => handleToggleEnabled(charge)}
                              className="mr-2"
                              disabled={isSuspended}
                              title={isSuspended ? "Admin has suspended this charge" : undefined}
                            >
                              {charge.isEnabled ? <PowerOff /> : <Power />}
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleArchive(charge)}><Trash2 /></Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No charges configured yet.</p>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <ChargeEditDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSave}
          item={editingCharge}
        />
      )}
      {Dialog}
    </>
  );
}
