
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, deleteDoc, setDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Sparkles, Trash2, ArrowLeft, Archive, ArchiveRestore } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FlavorEditDialog } from "@/components/admin/menu/flavor-edit-dialog";
import type { Flavor } from "@/lib/types";
import { errorEmitter, FirestorePermissionError } from "@/firebase";
import { useRouter } from "next/navigation";
import { rebuildCustomerRefillOptionsCachesSafely, rebuildStoreConfigsSafely } from "@/lib/manager/dataManagement";

export default function FlavorsManagementPage() {
  const router = useRouter();
  const { appUser, isSigningOut, loading: authLoading } = useAuthContext();
  const { toast } = useToast();
  const [flavors, setFlavors] = useState<Flavor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Global flavor activation is a chain-wide gate. Rebuild each POS config and
  // customer refill cache after deactivation/archive so persisted store choices
  // stop being offered immediately while remaining available for restoration.
  const refreshFlavorVisibilityCaches = async () => {
    try {
      const storesSnap = await getDocs(collection(db, "stores"));
      const storeIds = storesSnap.docs.map((d) => d.id);
      const posResults = await rebuildStoreConfigsSafely(db, storeIds);
      await rebuildCustomerRefillOptionsCachesSafely(storeIds);
      const failures = posResults.filter((r) => !r.ok);
      if (failures.length) {
        toast({ variant: "destructive", title: "Some menus were not refreshed", description: `${failures.length} store POS cache(s) need a rebuild.` });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Menu caches not refreshed", description: error?.message || "The global flavor change was saved; run Data Management → Rebuild." });
    }
  };
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState<Flavor | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (authLoading || !appUser) {
      if (!authLoading) setIsLoading(false);
      return;
    };

    const flavorsRef = collection(db, "flavors");
    const unsubscribe = onSnapshot(flavorsRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Flavor));
      setFlavors(data.sort((a, b) => a.name.localeCompare(b.name)));
      setIsLoading(false);
    }, (error) => {
      if (isSigningOut || !appUser) return;
      console.error("Failed to fetch flavors:", error);
      const contextualError = new FirestorePermissionError({ operation: 'list', path: "flavors" });
      errorEmitter.emit("permission-error", contextualError);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch flavors." });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [appUser, authLoading, isSigningOut, toast]);

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
        .then(async () => {
          if (data.isActive !== editingFlavor.isActive) await refreshFlavorVisibilityCaches();
          toast({ title: "Flavor Updated" });
          handleCloseDialog();
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
            toast({ variant: "destructive", title: "Save Failed", description: error.message });
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
          toast({ variant: "destructive", title: "Save Failed", description: error.message });
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
        .then(async () => {
            await refreshFlavorVisibilityCaches(); // reactivation must also republish
            toast({ title: "Status Updated" });
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
            toast({ variant: "destructive", title: "Update Failed", description: error.message });
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
        .then(async () => {
            await refreshFlavorVisibilityCaches();
            toast({ title: "Flavor Archived" });
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
            toast({ variant: "destructive", title: "Archive Failed", description: error.message });
        });
  };

  const handleRestore = async (item: Flavor) => {
    if (!appUser) return;
    const docRef = doc(db, "flavors", item.id);
    const payload = { isArchived: false, updatedAt: serverTimestamp() };
    updateDoc(docRef, payload)
        .then(() => {
            toast({ title: "Flavor Restored", description: `${item.name} restored. Activate it manually when ready.` });
        })
        .catch(async (error: any) => {
            const contextualError = new FirestorePermissionError({ operation: 'update', path: docRef.path, requestResourceData: payload });
            errorEmitter.emit("permission-error", contextualError);
            toast({ variant: "destructive", title: "Restore Failed", description: error.message });
        });
  };

  const archivedFlavors = flavors.filter(f => f.isArchived === true);

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Flavors" description="Manage global flavor options.">
        <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => handleOpenDialog()}>
            <PlusCircle className="mr-2" /> New Flavor
            </Button>
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>All Flavors</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? <Loader className="animate-spin" /> : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flavors.filter(f => f.isArchived !== true).map((item) => (
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
            {archivedFlavors.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-2">
                  <Archive className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold text-muted-foreground">Archived</h3>
                  <Badge variant="secondary" className="text-xs">{archivedFlavors.length}</Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedFlavors.map((item) => (
                      <TableRow key={item.id} className="opacity-70">
                        <TableCell className="font-medium line-through decoration-muted-foreground/60">{item.name}</TableCell>
                        <TableCell><Badge variant="secondary">Archived</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button variant="default" size="sm" onClick={() => handleRestore(item)}>
                            <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            </>
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
