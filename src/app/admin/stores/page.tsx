
"use client";

import { useState, useEffect } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, addDoc, writeBatch, Timestamp, getDocs, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Download } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StoreEditDialog } from "@/components/admin/store-edit-dialog";
import { logActivity } from "@/lib/firebase/activity-log";
import { format } from "date-fns";
import { StoreDetailsModal } from "@/components/admin/store-details-modal";

export type Store = {
  id: string;
  name: string;
  code: string;
  address: string;
  isActive: boolean;
  openingDate?: Timestamp | null;
  contactNumber?: string;
  email?: string;
  createdAt: any;
  updatedAt: any;
};

// Helper function to recursively get all subcollections
async function getSubCollections(docRef: any) {
    const subCollections: any = {};
    const collectionsSnapshot = await getDocs(collection(docRef, 'subcollections')); // This is a placeholder, Firestore SDK doesn't have a direct way to list subcollections client-side. A better approach would be to know the subcollection names.
    
    // For this implementation, we will assume we know the subcollection names.
    const knownSubcollections = ["inventory", "menu", "tables", "orders", "storePackages", "storeAddons", "sessions", "kitchenLocations", "activityLogs"];

    for (const subCollectionName of knownSubcollections) {
        const subCollectionRef = collection(docRef, subCollectionName);
        const subCollectionSnapshot = await getDocs(subCollectionRef);
        if (!subCollectionSnapshot.empty) {
            subCollections[subCollectionName] = await getCollectionData(subCollectionRef);
        }
    }
    return subCollections;
}


// Helper function to get all documents in a collection and their subcollections
async function getCollectionData(collectionRef: any) {
    const collectionData: any = {};
    const querySnapshot = await getDocs(collectionRef);
    for (const docSnapshot of querySnapshot.docs) {
        const docData = docSnapshot.data();
        const subCollections = await getSubCollections(docSnapshot.ref);
        collectionData[docSnapshot.id] = { ...docData, ...subCollections };
    }
    return collectionData;
}


export default function StoreManagementPage() {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [stores, setStores] = useState<Store[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const { confirm, Dialog } = useConfirmDialog();

  useEffect(() => {
    if (!appUser || appUser.role !== 'admin') return;

    const storesRef = collection(db, "stores");
    const unsubscribe = onSnapshot(storesRef, (snapshot) => {
      const storesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Store));
      setStores(storesData);
      setIsLoading(false);
    }, (error) => {
      console.error("Failed to fetch stores:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch stores." });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [appUser, toast]);

  const handleOpenDialog = (store: Store | null = null) => {
    setEditingStore(store);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingStore(null);
    setIsDialogOpen(false);
  };

  const handleSaveStore = async (storeData: Omit<Store, 'id' | 'createdAt' | 'updatedAt' | 'openingDate'> & { openingDate?: Date | null }) => {
    if (!appUser) return;
    setIsSubmitting(true);
    
    const dataToSave: any = {
      ...storeData,
      openingDate: storeData.openingDate ? Timestamp.fromDate(storeData.openingDate) : null,
    };

    try {
      if (editingStore) {
        // Update existing store
        const storeDocRef = doc(db, "stores", editingStore.id);
        await updateDoc(storeDocRef, {
          ...dataToSave,
          updatedAt: serverTimestamp(),
        });
        await logActivity(appUser, "store_updated", `Updated store: ${storeData.name}`);
        toast({ title: "Store Updated", description: "The store details have been saved." });
      } else {
        // Create new store using a write batch for atomicity
        const newDocRef = doc(collection(db, "stores"));
        const batch = writeBatch(db);
        
        batch.set(newDocRef, {
            ...dataToSave,
            id: newDocRef.id, // Set the id field to the document's ID
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        await batch.commit();
        await logActivity(appUser, "store_created", `Created new store: ${storeData.name}`);
        toast({ title: "Store Created", description: "The new store has been added." });
      }
      handleCloseDialog();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: error.message || "Could not save the store details.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (store: Store) => {
    if (!appUser) return;
    const newStatus = !store.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    const confirmed = await confirm({
        title: `${action} ${store.name}?`,
        description: `Are you sure you want to ${action.toLowerCase()} this store?`,
        confirmText: `Yes, ${action}`,
        destructive: !newStatus,
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    try {
        const storeDocRef = doc(db, "stores", store.id);
        await updateDoc(storeDocRef, {
            isActive: newStatus,
            updatedAt: serverTimestamp(),
        });
        await logActivity(appUser, newStatus ? "store_activated" : "store_deactivated", `${action}d store: ${store.name}`);
        toast({ title: "Store Status Updated", description: `${store.name} has been ${action.toLowerCase()}d.` });
    } catch (error: any) {
        toast({
            variant: "destructive",
            title: "Update Failed",
            description: error.message || "Could not update the store status.",
        });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleEditFromDetails = (store: Store) => {
    setSelectedStore(null);
    handleOpenDialog(store);
  };

  const downloadStoreData = async (storeId: string) => {
        setIsDownloading(storeId);
        toast({ title: 'Exporting...', description: 'Fetching store data. This may take a moment.' });
        try {
            const storeRef = doc(db, "stores", storeId);
            const storeDoc = await getDoc(storeRef);

            if (!storeDoc.exists()) {
                toast({ variant: 'destructive', title: 'Error', description: 'Store not found.' });
                return;
            }

            const storeData = { [storeId]: { ...storeDoc.data() } };
            
            // Known subcollections to export
            const subcollections = ["inventory", "menu", "tables", "orders", "storePackages", "storeAddons", "sessions"];
            for (const subcollection of subcollections) {
                const subRef = collection(storeRef, subcollection);
                const subSnapshot = await getDocs(subRef);
                if (!subSnapshot.empty) {
                    storeData[storeId][subcollection] = {};
                    for (const subDoc of subSnapshot.docs) {
                        storeData[storeId][subcollection][subDoc.id] = subDoc.data();
                        
                        // Handle nested subcollections if necessary, e.g., orderItems
                        if (subcollection === 'orders') {
                           const itemsRef = collection(subDoc.ref, 'orderItems');
                           const itemsSnap = await getDocs(itemsRef);
                           if (!itemsSnap.empty) {
                               storeData[storeId][subcollection][subDoc.id].orderItems = {};
                               itemsSnap.forEach(itemDoc => {
                                   storeData[storeId][subcollection][subDoc.id].orderItems[itemDoc.id] = itemDoc.data();
                               })
                           }
                        }
                    }
                }
            }
            
            const jsonString = JSON.stringify(storeData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `store_${storeId}_export.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            toast({ title: 'Export Complete', description: 'Store data has been downloaded.' });
        } catch (error: any) {
            console.error("Export failed:", error);
            toast({ variant: 'destructive', title: 'Export Failed', description: error.message });
        } finally {
            setIsDownloading(null);
        }
    };


  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Store Management" description="Create, edit, and manage all store locations.">
        <Button onClick={() => handleOpenDialog()}>
          <PlusCircle className="mr-2" />
          Create Store
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>All Stores</CardTitle>
          <CardDescription>A list of all stores in the system.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader className="animate-spin" />
            </div>
          ) : stores.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Opening Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((store) => (
                  <TableRow key={store.id} onClick={() => setSelectedStore(store)} className="cursor-pointer">
                    <TableCell className="font-medium">{store.name}</TableCell>
                    <TableCell>{store.code}</TableCell>
                    <TableCell>
                        <div className="text-sm">{store.contactNumber || 'N/A'}</div>
                        <div className="text-xs text-muted-foreground">{store.email || ''}</div>
                    </TableCell>
                    <TableCell>
                        {store.openingDate ? format(store.openingDate.toDate(), 'yyyy-MM-dd') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={store.isActive ? "default" : "secondary"}>
                        {store.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                       <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); downloadStoreData(store.id); }} className="mr-2" disabled={isDownloading === store.id}>
                          {isDownloading === store.id ? <Loader className="animate-spin" /> : <Download />}
                       </Button>
                      <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenDialog(store); }} className="mr-2">
                        Edit
                      </Button>
                      <Button
                        variant={store.isActive ? "destructive" : "default"}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(store);}}
                        disabled={isSubmitting}
                      >
                         {store.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                        {store.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No stores found. Click "Create Store" to add one.</p>
          )}
        </CardContent>
      </Card>

      {isDialogOpen && (
        <StoreEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSaveStore}
          store={editingStore}
          isSubmitting={isSubmitting}
        />
      )}
      
      {selectedStore && (
        <StoreDetailsModal
            isOpen={!!selectedStore}
            onClose={() => setSelectedStore(null)}
            store={selectedStore}
            onEdit={handleEditFromDetails}
        />
      )}

      {Dialog}
    </RoleGuard>
  );
}
