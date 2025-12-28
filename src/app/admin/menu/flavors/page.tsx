
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
import { Loader, PlusCircle, Power, PowerOff, Sparkles } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { logActivity } from "@/lib/firebase/activity-log";
import { FlavorEditDialog } from "@/components/admin/menu/flavor-edit-dialog";

export type Flavor = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export default function FlavorsManagementPage() {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [flavors, setFlavors] = useState<Flavor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<Flavor | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!appUser) return;

    const flavorsRef = collection(db, "flavors");
    const unsubscribe = onSnapshot(flavorsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Flavor));
      setFlavors(data.sort((a, b) => a.name.localeCompare(b.name)));
      setIsLoading(false);
    }, (error) => {
      console.error("Failed to fetch flavors:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch flavors." });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [appUser, toast]);

  const handleOpenDialog = (flavor: Flavor | null = null) => {
    setEditingFlavor(flavor);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingFlavor(null);
    setIsDialogOpen(false);
  };

  const handleSave = async (data: Omit<Flavor, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!appUser) return;
    setIsSubmitting(true);

    try {
      if (editingFlavor) {
        const docRef = doc(db, "flavors", editingFlavor.id);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
        await logActivity(appUser, "flavor_updated", `Updated flavor: ${data.name}`);
        toast({ title: "Flavor Updated" });
      } else {
        const newDocRef = doc(collection(db, "flavors"));
        await writeBatch(db).set(newDocRef, {
          ...data,
          id: newDocRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }).commit();
        await logActivity(appUser, "flavor_created", `Created new flavor: ${data.name}`);
        toast({ title: "Flavor Created" });
      }
      handleCloseDialog();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (item: Flavor) => {
    if (!appUser) return;
    const newStatus = !item.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    if (!(await confirm({
        title: `${action} ${item.name}?`,
        confirmText: `Yes, ${action}`,
        destructive: !newStatus,
    }))) return;

    try {
        await updateDoc(doc(db, "flavors", item.id), { isActive: newStatus, updatedAt: serverTimestamp() });
        await logActivity(appUser, newStatus ? "flavor_activated" : "flavor_deactivated", `${action}d flavor: ${item.name}`);
        toast({ title: "Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    }
  };

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Flavors" description="Manage global flavor options.">
        <Button onClick={() => handleOpenDialog()}>
          <PlusCircle className="mr-2" /> New Flavor
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>All Flavors</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Loader className="animate-spin" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flavors.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
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
        <FlavorEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSave}
          item={editingFlavor}
          isSubmitting={isSubmitting}
        />
      )}
      {Dialog}
    </RoleGuard>
  );
}
