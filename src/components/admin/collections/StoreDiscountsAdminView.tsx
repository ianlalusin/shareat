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
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, Pause, Play, Trash2, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DiscountEditDialog } from "@/components/manager/collections/DiscountEditDialog";
import { rebuildStoreConfigsSafely } from "@/lib/manager/dataManagement";
import type { Discount, Store } from "@/lib/types";

function formatScope(scope: ("item" | "bill")[] | undefined | string) {
  if (!scope) return "—";
  const arr = Array.isArray(scope) ? scope : [scope];
  return arr.map(s => (s === "item" ? "Item" : "Bill")).join(", ");
}

export function StoreDiscountsAdminView({
  stores,
  selectedStoreId,
  onSelectedStoreChange,
}: {
  stores: Store[];
  selectedStoreId: string;
  onSelectedStoreChange: (id: string) => void;
}) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);

  useEffect(() => {
    if (!selectedStoreId) {
      setDiscounts([]);
      return;
    }
    setIsLoading(true);
    const ref = collection(db, "stores", selectedStoreId, "storeDiscounts");
    const q = query(ref, where("isArchived", "==", false));
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Discount));
        data.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
        setDiscounts(data);
        setIsLoading(false);
      },
      err => {
        toast({ variant: "destructive", title: "Error", description: err.message });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [selectedStoreId, toast]);

  const handleOpenDialog = (d: Discount) => {
    setEditing(d);
    setIsDialogOpen(true);
  };

  const syncSelected = async () => {
    if (!selectedStoreId) return;
    const [result] = await rebuildStoreConfigsSafely(db, [selectedStoreId]);
    if (result && !result.ok) {
      toast({
        variant: "destructive",
        title: "Store sync incomplete",
        description: "POS may show stale data until the next manual sync.",
      });
    }
  };

  const handleSave = async (data: Partial<Omit<Discount, "id">>) => {
    if (!appUser || !editing || !selectedStoreId) return;
    try {
      const ref = doc(db, "stores", selectedStoreId, "storeDiscounts", editing.id);
      await updateDoc(ref, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
      toast({ title: "Discount Updated (admin)" });
      setIsDialogOpen(false);
      await syncSelected();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save Failed", description: e.message });
    }
  };

  const handleToggleSuspend = async (d: Discount) => {
    if (!appUser) return;
    const next = !d.adminSuspended;
    const action = next ? "Suspend" : "Unsuspend";
    if (!(await confirm({
      title: `${action} ${d.name}?`,
      description: next
        ? "Suspension hides this discount from the cashier regardless of the manager's enable toggle."
        : "The manager's own enable/disable toggle will once again determine availability.",
      confirmText: `Yes, ${action}`,
      destructive: next,
    }))) return;

    const ref = doc(db, "stores", selectedStoreId, "storeDiscounts", d.id);
    await updateDoc(ref, {
      adminSuspended: next,
      adminSuspendedAt: next ? serverTimestamp() : null,
      adminSuspendedBy: next ? appUser.uid : null,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp(),
    });
    toast({ title: next ? "Discount Suspended" : "Discount Unsuspended" });
    await syncSelected();
  };

  const handleArchive = async (d: Discount) => {
    if (!appUser) return;
    if (!(await confirm({
      title: `Archive ${d.name}?`,
      description: "Archived discounts can be recovered later.",
      confirmText: "Yes, Archive",
      destructive: true,
    }))) return;
    const ref = doc(db, "stores", selectedStoreId, "storeDiscounts", d.id);
    await updateDoc(ref, {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp(),
    });
    toast({ title: "Discount Archived" });
    await syncSelected();
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Store-scoped Discounts</CardTitle>
          <CardDescription>
            Oversee discounts created by store managers. Suspend to override the manager's enable toggle, or edit/archive on their behalf.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Select value={selectedStoreId} onValueChange={onSelectedStoreChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>
          ) : !selectedStoreId ? (
            <p className="text-center text-muted-foreground py-8">Select a store to view its discounts.</p>
          ) : discounts.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">This store has no discounts configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map(d => (
                  <TableRow key={d.id} className={d.adminSuspended ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="capitalize">{d.type}</TableCell>
                    <TableCell>{d.type === "percent" ? `${d.value}%` : `₱${d.value.toFixed(2)}`}</TableCell>
                    <TableCell className="capitalize">{formatScope(d.scope)}</TableCell>
                    <TableCell className="space-x-1">
                      <Badge variant={d.isEnabled ? "default" : "outline"}>
                        {d.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                      {d.adminSuspended && (
                        <Badge variant="destructive" className="inline-flex items-center gap-1">
                          <Ban className="h-3 w-3" /> Suspended
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{d.sortOrder}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(d)}>Edit</Button>
                      <Button
                        variant={d.adminSuspended ? "default" : "secondary"}
                        size="sm"
                        onClick={() => handleToggleSuspend(d)}
                      >
                        {d.adminSuspended ? <><Play className="mr-1 h-4 w-4" /> Unsuspend</> : <><Pause className="mr-1 h-4 w-4" /> Suspend</>}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleArchive(d)}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <DiscountEditDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={(data) => handleSave(data)}
          item={editing}
        />
      )}
      {Dialog}
    </>
  );
}
