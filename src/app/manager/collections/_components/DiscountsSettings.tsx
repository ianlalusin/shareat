
"use client";

import { useState, useEffect } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp, addDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Loader, PlusCircle, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { logActivity } from "@/lib/firebase/activity-log";
import { DiscountEditDialog } from "./DiscountEditDialog";
import { Checkbox } from "@/components/ui/checkbox";

export type Discount = {
  id: string;
  name: string;
  type: "fixed" | "percent";
  value: number;
  scope: "bill" | "item" | ("bill" | "item")[];
  stackable: boolean;
  isEnabled: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
};

export function DiscountsSettings({ store }: { store: Store }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);

  useEffect(() => {
    if (!store?.id) {
      setDiscounts([]);
      setIsLoading(false);
      return;
    }
    
    setIsLoading(true);
    const discountsRef = collection(db, "stores", store.id, "storeDiscounts");
    const q = query(discountsRef, where("isArchived", "==", false));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Discount));
      data.sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
      setDiscounts(data);
      setIsLoading(false);
    }, (error) => {
      toast({ variant: "destructive", title: "Error", description: `Could not fetch discounts: ${error.message}` });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [store?.id, toast]);

  const handleOpenDialog = (discount: Discount | null = null) => {
    setEditingDiscount(discount);
    setIsDialogOpen(true);
  };

  const handleSave = async (data: Partial<Omit<Discount, 'id'>>, isCreating: boolean) => {
    if (!appUser) return;

    const nameLower = data.name!.toLowerCase();
    const isDuplicate = discounts.some(d => d.name.toLowerCase() === nameLower && d.id !== editingDiscount?.id);
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
        await logActivity(appUser, "discount_created", `Created discount: ${data.name}`);
        toast({ title: "Discount Created" });
      } else if (editingDiscount) {
        const docRef = doc(db, "stores", store.id, "storeDiscounts", editingDiscount.id);
        await updateDoc(docRef, { ...data, updatedBy: appUser.uid, updatedAt: serverTimestamp() });
        await logActivity(appUser, "discount_updated", `Updated discount: ${data.name}`);
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
    await logActivity(appUser, `discount_${action.toLowerCase()}`, `${action}d discount: ${discount.name}`);
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
    await logActivity(appUser, 'discount_archived', `Archived discount: ${discount.name}`);
  };

  if (isLoading) {
    return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
  }
  
  const formatScope = (scope: Discount['scope']) => {
    if (Array.isArray(scope)) {
      return scope.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(', ');
    }
    if (typeof scope === 'string') {
        return scope.charAt(0).toUpperCase() + scope.slice(1);
    }
    return '—';
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Discounts</CardTitle>
          <CardDescription>Manage discounts applicable for this store.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-end mb-4">
            <Button onClick={() => handleOpenDialog()}>
              <PlusCircle className="mr-2" /> New Discount
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
                  <TableHead>Stackable</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sort Order</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discounts.map(discount => (
                  <TableRow key={discount.id}>
                    <TableCell className="font-medium">{discount.name}</TableCell>
                    <TableCell className="capitalize">{discount.type}</TableCell>
                    <TableCell>{discount.type === 'percent' ? `${discount.value}%` : `₱${discount.value.toFixed(2)}`}</TableCell>
                    <TableCell className="capitalize">{formatScope(discount.scope)}</TableCell>
                    <TableCell><Checkbox checked={discount.stackable} disabled /></TableCell>
                    <TableCell><Badge variant={discount.isEnabled ? "default" : "outline"}>{discount.isEnabled ? "Enabled" : "Disabled"}</Badge></TableCell>
                    <TableCell>{discount.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(discount)} className="mr-2">Edit</Button>
                      <Button variant={discount.isEnabled ? "secondary" : "default"} size="sm" onClick={() => handleToggleEnabled(discount)} className="mr-2">
                        {discount.isEnabled ? <PowerOff /> : <Power />}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleArchive(discount)}><Trash2 /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
