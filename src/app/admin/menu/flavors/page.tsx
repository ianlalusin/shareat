
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, deleteDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Sparkles, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FlavorEditDialog } from "@/components/admin/menu/flavor-edit-dialog";
import type { Flavor } from "@/lib/types";
import { errorEmitter, FirestorePermissionError } from "@/firebase";

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
      const contextualError = new FirestorePermissionError({ operation: 'list', path: "flavors" });
      errorEmitter.emit("permission-error", contextualError);
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

  const handleSave = (data: Omit<Flavor, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!appUser) return;
    setIsSubmitting(true);

    if (editingFlavor) {
      const docRef = doc(db, "flavors", editingFlavor.id);
      const payload = { ...data, updatedAt: serverTimestamp() };
      updateDoc(docRef, payload)
        .then(() => {
          toast({ title: "Flavor Updated" });
          handleCloseDialog();
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
        })
        .finally(() => {
          setIsSubmitting(false);
        });
    } else {
      const newDocRef = doc(collection(db, "flavors"));
      const payload = { ...data, id: newDocRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      setDoc(newDocRef, payload)
        .then(() => {
          toast({ title: "Flavor Created" });
          handleCloseDialog();
        })
        .catch(async (error: any) => {
          const contextualError = new FirestorePermissionError({ operation: 'create', path: newDocRef.path, requestResourceData: payload });
          errorEmitter.emit("permission-error", contextualError);
        })
        .finally(() => {
          setIsSubmitting(false);
        });
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
    
    const docRef = doc(db, "flavors", item.id);
    const payload = { isActive: newStatus, updatedAt: serverTimestamp() };
    updateDoc(docRef, payload)
        .then(() => {
            toast({ title: "Status Updated" });
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
        });
  };

  const handleDelete = async (item: Flavor) => {
    if (!appUser) return;
    if (!(await confirm({
        title: `Archive ${item.name}?`,
        description: "Archived items are hidden but can be recovered. Are you sure?",
        confirmText: "Yes, Archive",
        destructive: true,
    }))) return;

    const docRef = doc(db, "flavors", item.id);
    const payload = { isActive: false, isArchived: true, updatedAt: serverTimestamp() };
    updateDoc(docRef, payload)
        .then(() => {
            toast({ title: "Flavor Archived" });
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
        });
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
                {flavors.filter(f => !(f as any).isArchived).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
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
