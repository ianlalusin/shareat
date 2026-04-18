
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp, addDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, PlusCircle, Power, PowerOff, Trash2, Globe, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DiscountEditDialog } from "./DiscountEditDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { subscribeApplicableGlobalDiscounts, discountDateStatus } from "@/lib/collections/globalCollections";
import type { Store, Discount, GlobalDiscount } from "@/lib/types";

function formatScope(scope: ("item" | "bill")[] | undefined | string) {
  if (!scope) return "—";
  const scopeArray = Array.isArray(scope) ? scope : [scope];
  return scopeArray
    .map(s => (s === "item" ? "Item" : "Bill"))
    .join(", ");
}

export function DiscountsSettings({ store }: { store: Store }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [storeDiscounts, setStoreDiscounts] = useState<Discount[]>([]);
  const [globalDiscounts, setGlobalDiscounts] = useState<GlobalDiscount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);

  useEffect(() => {
    if (!store?.id) {
      setStoreDiscounts([]);
      setGlobalDiscounts([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const discountsRef = collection(db, "stores", store.id, "storeDiscounts");
    const q = query(discountsRef, where("isArchived", "==", false));

    const unsubStore = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));
      setStoreDiscounts(data);
      setIsLoading(false);
    }, (error) => {
      toast({ variant: "destructive", title: "Error", description: `Could not fetch discounts: ${error.message}` });
      setIsLoading(false);
    });

    const unsubGlobal = subscribeApplicableGlobalDiscounts(
      db,
      store.id,
      (items) => setGlobalDiscounts(items),
      (err) => console.error("Global discounts subscribe error:", err)
    );

    return () => {
      unsubStore();
      unsubGlobal();
    };
  }, [store?.id, toast]);

  const discounts = useMemo<Discount[]>(() => {
    const taggedStore: Discount[] = storeDiscounts.map(d => ({ ...d, source: "store" as const }));
    const taggedGlobal: Discount[] = globalDiscounts.map(g => ({
      id: g.id,
      name: g.name,
      type: g.type,
      value: g.value,
      scope: g.scope,
      stackable: g.stackable,
      isEnabled: g.isEnabled,
      sortOrder: g.sortOrder,
      isArchived: g.isArchived,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      createdBy: g.createdBy,
      updatedBy: g.updatedBy,
      startDate: g.startDate,
      endDate: g.endDate,
      source: "global" as const,
    }));
    const merged = [...taggedStore, ...taggedGlobal];
    merged.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
    return merged;
  }, [storeDiscounts, globalDiscounts]);

  const handleOpenDialog = (discount: Discount | null = null) => {
    setEditingDiscount(discount);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: Partial<Omit<Discount, 'id'>>, isCreating: boolean) => {
    if (!appUser) return;

    const nameLower = data.name!.toLowerCase();
    const isDuplicate = storeDiscounts.some(d => d.name.toLowerCase() === nameLower && d.id !== editingDiscount?.id);
    if (isDuplicate) {
      toast({ variant: "destructive", title: "Duplicate Name", description: "A discount with this name already exists." });
      return;
    }

    try {
      if (isCreating) {
        const discountsRef = collection(db, "stores", store.id, "storeDiscounts");
        const newDoc = {
          ...data,
          isArchived: false,
          createdBy: appUser.uid,
          updatedBy: appUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        const docRef = await addDoc(discountsRef, newDoc);
        await updateDoc(docRef, { id: docRef.id });
        toast({ title: "Discount Created" });
      } else if (editingDiscount) {
        const docRef = doc(db, "stores", store.id, "storeDiscounts", editingDiscount.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        toast({ title: "Discount Updated" });
      }
      setIsDialogOpen(false);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    }
  };

  const handleToggleEnabled = async (discount: Discount) => {
    if (!appUser) return;
    const newStatus = !discount.isEnabled;
    const action = newStatus ? "Enable" : "Disable";

    if (!(await confirm({ title: `${action} ${discount.name}?`, confirmText: `Yes, ${action}` }))) return;

    const docRef = doc(db, "stores", store.id, "storeDiscounts", discount.id);
    await updateDoc(docRef, { isEnabled: newStatus, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
    toast({ title: "Status Updated" });
  };

  const handleArchive = async (discount: Discount) => {
    if (!appUser) return;
    if (!(await confirm({
        title: `Archive ${discount.name}?`,
        description: "Archived discounts can be recovered later.",
        confirmText: "Yes, Archive",
        destructive: true,
    }))) return;

    const docRef = doc(db, "stores", store.id, "storeDiscounts", discount.id);
    await updateDoc(docRef, {
      isArchived: true,
      archivedAt: serverTimestamp(),
      archivedBy: appUser.uid,
      updatedBy: appUser.uid,
      updatedAt: serverTimestamp()
    });
    toast({ title: "Discount Archived" });
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Discounts</CardTitle>
          <CardDescription>
            Manage discounts for this store. Entries marked <Badge variant="outline" className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Universal</Badge> are platform-wide and managed by an admin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Discount
            </Button>
          </div>
          {discounts.length > 0 ? (
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Value</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Stackable</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sort Order</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discounts.map(discount => {
                      const isGlobal = discount.source === "global";
                      const isSuspended = !!discount.adminSuspended;
                      const dateStatus = discountDateStatus(discount);
                      return (
                        <TableRow key={`${discount.source ?? "store"}-${discount.id}`} className={isSuspended ? "opacity-60" : ""}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {discount.name}
                              {isGlobal && (
                                <Badge variant="outline" className="inline-flex items-center gap-1">
                                  <Globe className="h-3 w-3" /> Universal
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="capitalize">{discount.type}</TableCell>
                          <TableCell>{discount.type === 'percent' ? `${discount.value}%` : `₱${discount.value.toFixed(2)}`}</TableCell>
                          <TableCell className="capitalize">{formatScope(discount.scope)}</TableCell>
                          <TableCell><Checkbox checked={discount.stackable} disabled /></TableCell>
                          <TableCell className="space-x-1">
                            <Badge variant={discount.isEnabled ? "default" : "outline"}>{discount.isEnabled ? "Enabled" : "Disabled"}</Badge>
                            {isSuspended && (
                              <Badge variant="destructive" className="inline-flex items-center gap-1">
                                <Ban className="h-3 w-3" /> Suspended by admin
                              </Badge>
                            )}
                            {dateStatus === "scheduled" && (
                              <Badge variant="secondary" className="text-[10px]">Scheduled ({discount.startDate})</Badge>
                            )}
                            {dateStatus === "expired" && (
                              <Badge variant="destructive" className="text-[10px]">Expired ({discount.endDate})</Badge>
                            )}
                          </TableCell>
                          <TableCell>{discount.sortOrder}</TableCell>
                          <TableCell className="text-right">
                            {isGlobal ? (
                              <span className="text-xs text-muted-foreground">Managed by admin</span>
                            ) : (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleOpenDialog(discount)} className="mr-2">Edit</Button>
                                <Button
                                  variant={discount.isEnabled ? "secondary" : "default"}
                                  size="sm"
                                  onClick={() => handleToggleEnabled(discount)}
                                  className="mr-2"
                                  disabled={isSuspended}
                                  title={isSuspended ? "Admin has suspended this discount" : undefined}
                                >
                                  {discount.isEnabled ? <PowerOff /> : <Power />}
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => handleArchive(discount)}><Trash2 /></Button>
                              </>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile Cards */}
              <div className="lg:hidden space-y-3">
                {discounts.map(discount => {
                  const isGlobal = discount.source === "global";
                  const isSuspended = !!discount.adminSuspended;
                  return (
                    <Card key={`${discount.source ?? "store"}-${discount.id}`} className={isSuspended ? "opacity-60" : ""}>
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          {discount.name}
                          {isGlobal && <Badge variant="outline" className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> Universal</Badge>}
                        </CardTitle>
                        <CardDescription className="space-x-1">
                          <span>{discount.type === 'percent' ? `${discount.value}%` : `₱${discount.value.toFixed(2)}`}</span>
                          <Badge variant={discount.isEnabled ? "default" : "outline"} className="ml-2">{discount.isEnabled ? "Enabled" : "Disabled"}</Badge>
                          {isSuspended && <Badge variant="destructive" className="inline-flex items-center gap-1"><Ban className="h-3 w-3" /> Suspended</Badge>}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                          <p>Scope: {formatScope(discount.scope)}</p>
                          <p>Stackable: {discount.stackable ? 'Yes' : 'No'}</p>
                      </CardContent>
                      <CardFooter className="flex justify-end gap-2">
                          {isGlobal ? (
                            <span className="text-xs text-muted-foreground">Managed by admin</span>
                          ) : (
                            <>
                              <Button variant="outline" size="sm" onClick={() => handleOpenDialog(discount)} className="mr-2">Edit</Button>
                              <Button
                                variant={discount.isEnabled ? "secondary" : "default"}
                                size="sm"
                                onClick={() => handleToggleEnabled(discount)}
                                className="mr-2"
                                disabled={isSuspended}
                              >
                                  {discount.isEnabled ? <PowerOff /> : <Power />}
                              </Button>
                              <Button variant="destructive" size="sm" onClick={() => handleArchive(discount)}><Trash2 /></Button>
                            </>
                          )}
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">No discounts configured yet.</p>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <DiscountEditDialog
          isOpen={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onSave={handleSave}
          item={editingDiscount}
        />
      )}
      {Dialog}
    </>
  );
}
