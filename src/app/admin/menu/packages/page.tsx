
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Box, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PackageEditDialog } from "@/components/admin/menu/package-edit-dialog";
import type { Refill, Package } from "@/lib/types";

export default function PackagesManagementPage() {
  const { appUser, isSigningOut } = useAuthContext();
  const { toast } = useToast();
  const [packages, setPackages] = useState<Package[]>([]);
  const [refills, setRefills] = useState<Refill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<Package | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!appUser) {
      if (isLoading) setIsLoading(false);
      return;
    }
    
    const collectionsToFetch = [
      { name: "packages", setter: setPackages },
      { name: "refills", setter: setRefills }
    ];
    
    const unsubs = collectionsToFetch.map(({ name, setter }) => 
      onSnapshot(collection(db, name), (snapshot) => {
        setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      }, (error) => {
        if (isSigningOut) return;
        console.error(`Failed to fetch ${name}:`, error);
        toast({ variant: "destructive", title: "Error", description: `Could not fetch ${name}.` });
      })
    );
    
    // Set loading to false once initial subscriptions are set up
    Promise.all(unsubs).then(() => setIsLoading(false));

    return () => unsubs.forEach(unsub => unsub());
  }, [appUser, toast, isSigningOut, isLoading]);

  const handleOpenDialog = (pkg: Package | null = null) => {
    setEditingPackage(pkg);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingPackage(null);
    setIsDialogOpen(false);
  };

  const handleSave = async (data: Omit<Package, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!appUser) return;
    setIsSubmitting(true);

    try {
      if (editingPackage) {
        const docRef = doc(db, "packages", editingPackage.id);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
        toast({ title: "Package Updated" });
      } else {
        const newDocRef = doc(collection(db, "packages"));
        await writeBatch(db).set(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).commit();
        toast({ title: "Package Created" });
      }
      handleCloseDialog();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: Package) => {
    if (!appUser) return;
    const newStatus = !item.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    if (!(await confirm({
        title: `${action} ${item.name}?`,
        confirmText: `Yes, ${action}`,
        destructive: !newStatus,
    }))) return;

    try {
        await updateDoc(doc(db, "packages", item.id), { isActive: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    }
  };

  const handleDelete = async (item: Package) => {
    if (!appUser) return;
    if (!(await confirm({
        title: `Archive ${item.name}?`,
        description: "Archived items are hidden but can be recovered. Are you sure?",
        confirmText: "Yes, Archive",
        destructive: true,
    }))) return;

    try {
        await updateDoc(doc(db, "packages", item.id), { isActive: false, isArchived: true, updatedAt: serverTimestamp() });
        toast({ title: "Package Archived" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Archive Failed", description: error.message });
    }
  };

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Packages" description="Manage global product packages and bundles.">
        <Button onClick={() => handleOpenDialog()}>
          <PlusCircle className="mr-2" /> New Package
        </Button>
      </PageHeader>
      <Card>
        <CardHeader><CardTitle>All Packages</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Loader className="animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Refills</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.filter(p => !(p as any).isArchived).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{(item.allowedRefillIds?.length || 0)}</TableCell>
                    <TableCell>
                      <Badge variant={item.isActive ? "default" : "secondary"}>
                        {item.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpenDialog(item)} className="mr-2">Edit</Button>
                      <Button variant={item.isActive ? "secondary" : "default"} size="sm" onClick={() => handleToggleActive(item)} className="mr-2">
                        {item.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                        {item.isActive ? "Deactivate" : "Activate"}
                      </Button>
                       <Button variant="destructive" size="sm" onClick={() => handleDelete(item)}>
                        <Trash2 />
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
        <PackageEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSave}
          item={editingPackage}
          isSubmitting={isSubmitting}
          refills={refills}
        />
      )}
      {Dialog}
    </RoleGuard>
  );
}
