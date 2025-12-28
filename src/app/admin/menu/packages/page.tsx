
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Box } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { logActivity } from "@/lib/firebase/activity-log";
import { PackageEditDialog } from "@/components/admin/menu/package-edit-dialog";
import { Refill } from "../refills/page";

export type Package = {
  id: string;
  name: string;
  allowedRefillIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export default function PackagesManagementPage() {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [packages, setPackages] = useState<Package[]>([]);
  const [refills, setRefills] = useState<Refill[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<Package | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!appUser) return;
    
    const collectionsToFetch = [
      { name: "packages", setter: setPackages },
      { name: "refills", setter: setRefills }
    ];
    
    const unsubs = collectionsToFetch.map(({ name, setter }) => 
      onSnapshot(collection(db, name), (snapshot) => {
        setter(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
      }, (error) => {
        console.error(`Failed to fetch ${name}:`, error);
        toast({ variant: "destructive", title: "Error", description: `Could not fetch ${name}.` });
      })
    );
    
    // Set loading to false once initial subscriptions are set up
    Promise.all(unsubs).then(() => setIsLoading(false));

    return () => unsubs.forEach(unsub => unsub());
  }, [appUser, toast]);

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
        await logActivity(appUser, "package_updated", `Updated package: ${data.name}`);
        toast({ title: "Package Updated" });
      } else {
        const newDocRef = doc(collection(db, "packages"));
        await writeBatch(db).set(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).commit();
        await logActivity(appUser, "package_created", `Created new package: ${data.name}`);
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
        await logActivity(appUser, newStatus ? "package_activated" : "package_deactivated", `${action}d package: ${item.name}`);
        toast({ title: "Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
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
                {packages.map((item) => (
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

    