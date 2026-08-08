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
import { UniversalDiscountEditDialog } from "./UniversalDiscountEditDialog";
import { rebuildStoreConfigsSafely } from "@/lib/manager/dataManagement";
import { discountDateStatus } from "@/lib/collections/globalCollections";
import type { GlobalDiscount, Store } from "@/lib/types";

function formatScope(scope: ("item" | "bill")[] | undefined | string) {
  if (!scope) return "—";
  const arr = Array.isArray(scope) ? scope : [scope];
  return arr.map(s => (s === "item" ? "Item" : "Bill")).join(", ");
}

export function UniversalDiscountsSettings({ stores }: { stores: Store[] }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [discounts, setDiscounts] = useState<GlobalDiscount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<GlobalDiscount | null>(null);

  useEffect(() => {
    setIsLoading(true);
    const q = query(collection(db, "globalDiscounts"), where("isArchived", "==", false));
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as GlobalDiscount));
        data.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
        setDiscounts(data);
        setIsLoading(false);
      },
      err => {
        toast({ variant: "destructive", title: "Error", description: `Could not fetch universal discounts: ${err.message}` });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [toast]);

  const storeNameById = (id: string) => stores.find(s => s.id === id)?.name || id;

  const handleOpenDialog = (item: GlobalDiscount | null = null) => {
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

  const handleSave = async (data: Partial<Omit<GlobalDiscount, "id">>, isCreating: boolean) => {
    if (!appUser) return;

    const nameLower = data.name!.toLowerCase();
    const isDuplicate = discounts.some(d => d.name.toLowerCase() === nameLower && d.id !== editing?.id);
    if (isDuplicate) {
      toast({ variant: "destructive", title: "Duplicate Name", description: "A universal discount with this name already exists." });
      return;
    }

    try {
      const prevStoreIds = editing?.applicableStoreIds || [];
      const nextStoreIds = (data.applicableStoreIds as string[] | undefined) || [];
      const affected = Array.from(new Set([...prevStoreIds, ...nextStoreIds]));

      if (isCreating) {
        const ref = collection(db, "globalDiscounts");
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
        toast({ title: "Universal Discount Created" });
      } else if (editing) {
        const docRef = doc(db, "globalDiscounts", editing.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        toast({ title: "Universal Discount Updated" });
      }
      setIsDialogOpen(false);
      await syncAndToast(affected);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save Failed", description: e.message });
    }
  };

  const handleToggleEnabled = async (item: GlobalDiscount) => {
    if (!appUser) return;
    const newStatus = !item.isEnabled;
    const action = newStatus ? "Enable" : "Disable";
    if (!(await confirm({ title: `${action} ${item.name}?`, confirmText: `Yes, ${action}` }))) return;
    const ref = doc(db, "globalDiscounts", item.id);
    await updateDoc(ref, { isEnabled: newStatus, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
    toast({ title: "Status Updated" });
    await syncAndToast(item.applicableStoreIds || []);
  };

  const handleArchive = async (item: GlobalDiscount) => {
    if (!appUser) return;
    if (!(await confirm({
      title: `Archive ${item.name}?`,
      description: "Archived universal discounts are removed from all assigned stores.",
      confirmText: "Yes, Archive",
      destructive: true,
    }))) return;
    const ref = doc(db, "globalDiscounts", item.id);
    await updateDoc(ref, {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp(),
    });
    toast({ title: "Universal Discount Archived" });
    await syncAndToast(item.applicableStoreIds || []);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> Universal Discounts</CardTitle>
          <CardDescription>
            Platform-wide discounts assigned to specific stores. Managers see these as read-only on their collections page.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Universal Discount
            </Button>
          </div>
          {discounts.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Stores</TableHead>
                  <TableHead>Availability</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map(d => {
                  const dateStatus = discountDateStatus(d);
                  const dateStatusBadge =
                    dateStatus === "scheduled" ? { variant: "secondary" as const, label: "Scheduled" }
                    : dateStatus === "expired" ? { variant: "destructive" as const, label: "Expired" }
                    : dateStatus === "active" ? { variant: "default" as const, label: "Active" }
                    : null;
                  return (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="capitalize">{d.type}</TableCell>
                    <TableCell>{d.type === "percent" ? `${d.value}%` : `₱${d.value.toFixed(2)}`}</TableCell>
                    <TableCell className="capitalize">{formatScope(d.scope)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(d.applicableStoreIds || []).length === 0
                          ? <span className="text-xs text-muted-foreground">None</span>
                          : (d.applicableStoreIds || []).map(id => (
                              <Badge key={id} variant="secondary" className="text-xs">{storeNameById(id)}</Badge>
                            ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.startDate || d.endDate ? (
                        <div className="space-y-0.5">
                          <div>{d.startDate || "—"} → {d.endDate || "—"}</div>
                          {dateStatusBadge && (
                            <Badge variant={dateStatusBadge.variant} className="text-[10px]">
                              {dateStatusBadge.label}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Always on</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.isEnabled ? "default" : "outline"}>
                        {d.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell>{d.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(d)} className="mr-2">Edit</Button>
                      <Button
                        variant={d.isEnabled ? "secondary" : "default"}
                        size="sm"
                        onClick={() => handleToggleEnabled(d)}
                        className="mr-2"
                      >
                        {d.isEnabled ? <PowerOff /> : <Power />}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleArchive(d)}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No universal discounts yet.</p>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <UniversalDiscountEditDialog
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
