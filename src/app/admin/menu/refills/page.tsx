
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, UtensilsCrossed } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { logActivity } from "@/lib/firebase/activity-log";
import { RefillEditDialog } from "@/components/admin/menu/refill-edit-dialog";
import type { StoreFlavor } from "@/components/manager/store-settings/store-packages-settings";
import { useStoreContext } from "@/context/store-context";

export type Refill = {
  id: string;
  name: string;
  requiresFlavor: boolean;
  allowedFlavorIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export default function RefillsManagementPage() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const [refills, setRefills] = useState<Refill[]>([]);
  const [flavors, setFlavors] = useState<StoreFlavor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRefill, setEditingRefill] = useState<Refill | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!appUser) return;

    const unsubs: (()=>void)[] = [];

    unsubs.push(onSnapshot(collection(db, "refills"), (snapshot) => {
        setRefills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Refill)));
    }));

    if (activeStore) {
        const flavorsRef = collection(db, "stores", activeStore.id, "storeFlavors");
        unsubs.push(onSnapshot(query(flavorsRef, where("isEnabled", "==", true)), (snapshot) => {
            setFlavors(snapshot.docs.map(doc => doc.data() as StoreFlavor));
        }));
    } else {
        setFlavors([]);
    }
    
    setIsLoading(false);

    return () => unsubs.forEach(unsub => unsub());
  }, [appUser, activeStore]);

  const handleOpenDialog = (item: Refill | null = null) => {
    setEditingRefill(item);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingRefill(null);
    setIsDialogOpen(false);
  };

  const handleSave = async (data: Omit<Refill, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!appUser) return;
    setIsSubmitting(true);

    try {
      if (editingRefill) {
        const docRef = doc(db, "refills", editingRefill.id);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
        await logActivity(appUser, "refill_updated", `Updated refill: ${data.name}`);
        toast({ title: "Refill Updated" });
      } else {
        const newDocRef = doc(collection(db, "refills"));
        await writeBatch(db).set(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).commit();
        await logActivity(appUser, "refill_created", `Created new refill: ${data.name}`);
        toast({ title: "Refill Created" });
      }
      handleCloseDialog();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: Refill) => {
    if (!appUser) return;
    const newStatus = !item.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    if (!(await confirm({ title: `${action} ${item.name}?`, confirmText: `Yes, ${action}`, destructive: !newStatus }))) return;

    try {
        await updateDoc(doc(db, "refills", item.id), { isActive: newStatus, updatedAt: serverTimestamp() });
        await logActivity(appUser, newStatus ? "refill_activated" : "refill_deactivated", `${action}d refill: ${item.name}`);
        toast({ title: "Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    }
  };

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Refills" description="Manage global refillable items.">
        <Button onClick={() => handleOpenDialog()}>
          <PlusCircle className="mr-2" /> New Refill
        </Button>
      </PageHeader>
      <Card>
        <CardHeader><CardTitle>All Refills</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader className="animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Requires Flavor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {refills.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.requiresFlavor ? "Yes" : "No"}</TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(item)} className="mr-2">Edit</Button>
                      <Button variant={item.isActive ? "destructive" : "default"} size="sm" onClick={() => handleToggleActive(item)}>
                        {item.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                        {item.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {isDialogOpen && (
        <RefillEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSave}
          item={editingRefill}
          isSubmitting={isSubmitting}
          flavors={flavors}
        />
      )}
      {Dialog}
    </RoleGuard>
  );
}
