
"use client";

import { useState, useEffect, useMemo } from "react";
import * as React from "react";
import { collection, onSnapshot, query, doc, writeBatch, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddInventoryDialog } from "@/components/manager/inventory/add-inventory-dialog";
import { EditInventoryDialog } from "@/components/manager/inventory/edit-inventory-dialog";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import type { InventoryItem, KitchenLocation } from "@/lib/types";
import { normalizeUom } from "@/lib/uom";
import { getDisplayName } from "@/lib/products/variants";
import { Switch } from "@/components/ui/switch";

export default function InventoryManagementPage() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  useEffect(() => {
    if (!activeStore) {
      setIsLoading(false);
      setInventory([]);
      return;
    }
    setIsLoading(true);
    
    const inventoryRef = collection(db, "stores", activeStore.id, "inventory");
    const q = query(inventoryRef);
    const unsubInv = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(items);
      setIsLoading(false);
    }, (error) => {
      console.error("Failed to fetch inventory:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch inventory." });
      setIsLoading(false);
    });
    
    const kitchenRef = collection(db, "stores", activeStore.id, "kitchenLocations");
    const unsubKitchen = onSnapshot(query(kitchenRef, where("isActive", "==", true)), (snapshot) => {
        setKitchenLocations(snapshot.docs.map(doc => doc.data() as KitchenLocation));
    }, (err) => {
      console.error("Failed to fetch kitchen locations:", err);
    });

    return () => { 
        unsubInv();
        unsubKitchen();
    };
  }, [activeStore, toast]);

  const groupedInventory = useMemo(() => {
    const grouped = inventory.reduce((acc, item) => {
      const subCategory = item.subCategory || 'Uncategorized';
      if (!acc[subCategory]) {
        acc[subCategory] = [];
      }
      acc[subCategory].push(item);
      return acc;
    }, {} as Record<string, InventoryItem[]>);

    // Sort items within each group
    for (const key in grouped) {
        grouped[key].sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
    }
    
    // Sort subcategories
    return Object.keys(grouped).sort().reduce((acc, subCategory) => {
        acc[subCategory] = grouped[subCategory];
        return acc;
    }, {} as Record<string, InventoryItem[]>);
  }, [inventory]);

  const handleAddItems = async (productsToAdd: any[]) => {
    if (!activeStore || !appUser) return;
    setIsSubmitting(true);

    const inventoryRef = collection(db, "stores", activeStore.id, "inventory");
    const batch = writeBatch(db);
    let addedCount = 0;
    let skippedCount = 0;

    for (const product of productsToAdd) {
      const isExisting = inventory.some(item => item.productId === product.id);
      if (isExisting) {
        skippedCount++;
        continue;
      }

      const newDocRef = doc(inventoryRef, product.id); // Use product ID as inventory ID
      batch.set(newDocRef, {
        id: newDocRef.id,
        productId: product.id,
        name: product.name,
        variantLabel: product.variantLabel || null,
        category: product.category || "",
        subCategory: product.subCategory || "",
        uom: normalizeUom(product.uom),
        cost: 0,
        sellingPrice: 0,
        isActive: true,
        isAddon: false, // Default to not being an add-on
        kitchenLocationId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      addedCount++;
    }

    try {
      await batch.commit();
      if (addedCount > 0) {
        toast({ title: "Inventory Updated", description: `${addedCount} new item(s) have been added.` });
      }
      if (skippedCount > 0) {
        toast({ variant: "default", title: "Duplicates Skipped", description: `${skippedCount} item(s) were already in the inventory.` });
      }
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
      setIsAddDialogOpen(false);
    }
  };

  const handleEditItem = async (item: InventoryItem, data: { cost: number; sellingPrice: number; kitchenLocationId: string | null; }) => {
     if (!activeStore || !appUser) return;
    setIsSubmitting(true);
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
        toast({ title: "Item Updated", description: `${getDisplayName(item)} details have been saved.`});
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
        setIsSubmitting(false);
        setIsEditOpen(false);
    }
  };
  
  const handleToggle = async (item: InventoryItem, field: 'isActive' | 'isAddon') => {
    if (!activeStore || !appUser) return;
    const newStatus = !item[field];

    if (field === 'isAddon' && newStatus) {
        if ((item.sellingPrice ?? 0) <= 0 || !item.kitchenLocationId) {
            toast({
                variant: "default",
                title: "Additional Info Required",
                description: `Please set a selling price and kitchen location to enable "${getDisplayName(item)}" as an add-on.`
            });
            setSelectedItem(item);
            setIsEditOpen(true);
            return;
        }
    }
    
    const action = newStatus ? "Enable" : "Disable";
    const fieldName = field === 'isActive' ? 'availability' : 'add-on status';
    
    const confirmed = await confirm({
        title: `${action} ${getDisplayName(item)}'s ${fieldName}?`,
        confirmText: `Yes, ${action}`,
    });

    if (!confirmed) return;
    
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, { [field]: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Item Status Updated" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    }
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!activeStore || !appUser) return;
    
    const confirmed = await confirm({
        title: `Delete ${getDisplayName(item)}?`,
        description: "This will permanently remove the item from this store's inventory. This action cannot be undone.",
        confirmText: "Yes, Delete",
        destructive: true,
    });

    if (!confirmed) return;
    
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, { isActive: false, isArchived: true, archivedAt: serverTimestamp() });
        toast({ title: "Inventory Item Archived" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Archive Failed", description: error.message });
    }
  };


  if (!activeStore) {
    return (
      <RoleGuard allow={["admin", "manager"]}>
        <div className="flex items-center justify-center h-full">
            <Card className="w-full max-w-md text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to manage its inventory.</CardDescription>
                </CardHeader>
            </Card>
        </div>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Inventory Management" description={`Manage stock for ${activeStore.name}`}>
        <Button onClick={() => setIsAddDialogOpen(true)}>
          <PlusCircle className="mr-2" />
          Add Products to Inventory
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>Current Stock</CardTitle>
          <CardDescription>All products currently tracked in this store's inventory.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40"><Loader className="animate-spin" /></div>
          ) : inventory.length > 0 ? (
            <Table>
              {Object.entries(groupedInventory).map(([subCategory, items]) => (
                <React.Fragment key={subCategory}>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                        <TableHead colSpan={6} className="text-lg font-semibold text-foreground">
                            {subCategory}
                        </TableHead>
                    </TableRow>
                    <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>Cost</TableHead>
                        <TableHead>Selling Price</TableHead>
                        <TableHead>Is Add-on</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium py-1">{getDisplayName(item)}</TableCell>
                        <TableCell className="py-1">₱{(item.cost || 0).toFixed(2)}</TableCell>
                        <TableCell className="py-1">₱{(item.sellingPrice || 0).toFixed(2)}</TableCell>
                        <TableCell className="py-1">
                          <Switch
                            checked={item.isAddon}
                            onCheckedChange={() => handleToggle(item, 'isAddon')}
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          <Badge variant={item.isActive ? "default" : "secondary"}>
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-1">
                          <Button variant="outline" size="sm" onClick={() => { setSelectedItem(item); setIsEditOpen(true); }} className="mr-2">
                            <Pencil />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleToggle(item, 'isActive')}>
                            {item.isActive ? <PowerOff className="text-destructive"/> : <Power />}
                          </Button>
                          {appUser?.role === 'admin' && (
                             <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteItem(item)}>
                                <Trash2 />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </React.Fragment>
              ))}
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No inventory items found. Click "Add Products" to get started.</p>
          )}
        </CardContent>
      </Card>

      {isAddDialogOpen && (
        <AddInventoryDialog
            isOpen={isAddDialogOpen}
            onClose={() => setIsAddDialogOpen(false)}
            onAddItems={handleAddItems}
            isSubmitting={isSubmitting}
            existingProductIds={inventory.map(i => i.productId)}
        />
      )}

      {isEditOpen && selectedItem && (
        <EditInventoryDialog
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
            item={selectedItem}
            kitchenLocations={kitchenLocations}
            onSave={handleEditItem}
            isSubmitting={isSubmitting}
        />
      )}
      
      {Dialog}
    </RoleGuard>
  );
}
