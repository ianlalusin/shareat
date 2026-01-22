
"use client";

import { useState, useEffect, useMemo } from "react";
import * as React from "react";
import { collection, onSnapshot, query, doc, writeBatch, serverTimestamp, updateDoc, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Pencil, Power, PowerOff, Search, RefreshCw, Archive, MoreHorizontal, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AddInventoryDialog } from "@/components/manager/inventory/add-inventory-dialog";
import { EditInventoryDialog } from "@/components/manager/inventory/edit-inventory-dialog";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import type { InventoryItem, KitchenLocation, Product } from "@/lib/types";
import { normalizeUom } from "@/lib/uom";
import { getDisplayName } from "@/lib/products/variants";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Image from "next/image";

export default function InventoryManagementPage() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!activeStore) {
      setIsLoading(false);
      setInventory([]);
      return;
    }
    setIsLoading(true);
    
    const inventoryRef = collection(db, "stores", activeStore.id, "inventory");
    const q = showArchived
      ? query(inventoryRef, where("isArchived", "==", true))
      : query(inventoryRef, where("isArchived", "!=", true));

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
  }, [activeStore, toast, showArchived]);

  const filteredInventory = useMemo(() => {
    if (!debouncedSearchTerm) {
      return inventory;
    }
    const lowercasedFilter = debouncedSearchTerm.toLowerCase();
    return inventory.filter(item => 
        getDisplayName(item).toLowerCase().includes(lowercasedFilter) ||
        item.barcode?.toLowerCase().includes(lowercasedFilter)
    );
  }, [inventory, debouncedSearchTerm]);


  const groupedInventory = useMemo(() => {
    const grouped = filteredInventory.reduce((acc, item) => {
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
  }, [filteredInventory]);

  const handleBackfill = async () => {
    if (!activeStore || !appUser) return;

    const confirmed = await confirm({
        title: "Backfill Inventory Data?",
        description: "This will scan all inventory items and copy missing image URLs and barcodes from the global product catalog. This action is safe to run multiple times.",
        confirmText: "Yes, Backfill",
    });

    if (!confirmed) return;

    setIsBackfilling(true);
    toast({ title: "Starting backfill...", description: "Fetching products and inventory." });

    try {
        const productsRef = collection(db, "products");
        const productsSnap = await getDocs(productsRef);
        const productsMap = new Map(productsSnap.docs.map(doc => [doc.id, doc.data() as Product]));

        const inventoryRef = collection(db, "stores", activeStore.id, "inventory");
        const inventorySnap = await getDocs(inventoryRef);
        
        const batch = writeBatch(db);
        let updatedCount = 0;

        inventorySnap.forEach(invDoc => {
            const inventoryItem = invDoc.data() as InventoryItem;
            const globalProduct = productsMap.get(inventoryItem.productId);

            if (globalProduct) {
                const updatePayload: Partial<InventoryItem> = {};
                let needsUpdate = false;

                if (globalProduct.imageUrl && !inventoryItem.imageUrl) {
                    updatePayload.imageUrl = globalProduct.imageUrl;
                    needsUpdate = true;
                }
                
                if (globalProduct.barcode && !inventoryItem.barcode) {
                    updatePayload.barcode = globalProduct.barcode;
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    batch.update(invDoc.ref, { ...updatePayload, updatedAt: serverTimestamp() });
                    updatedCount++;
                }
            }
        });

        if (updatedCount > 0) {
            await batch.commit();
            toast({ title: "Backfill Complete", description: `${updatedCount} inventory items were updated with missing data.` });
        } else {
            toast({ title: "No Updates Needed", description: "All inventory items are already up-to-date." });
        }

    } catch (error: any) {
        toast({ variant: "destructive", title: "Backfill Failed", description: error.message });
    } finally {
        setIsBackfilling(false);
    }
  };

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
        barcode: product.barcode || null,
        imageUrl: product.imageUrl || null,
        cost: 0,
        sellingPrice: 0,
        isActive: true,
        isAddon: false, // Default to not being an add-on
        isArchived: false,
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
      setSearchTerm("");
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
    if (!activeStore || !appUser?.isPlatformAdmin) return;
    
    const confirmed = await confirm({
        title: `Archive ${getDisplayName(item)}?`,
        description: "This will archive the item, hiding it from inventory. This action can be reversed by an administrator.",
        confirmText: "Yes, Archive",
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
  
  const handleRestoreItem = async (item: InventoryItem) => {
    if (!activeStore || !appUser?.isPlatformAdmin) {
        toast({ variant: "destructive", title: "Permission Denied", description: "Only admins can restore items." });
        return;
    };
    
    const confirmed = await confirm({
        title: `Restore ${getDisplayName(item)}?`,
        description: "This will un-archive the item. It will be inactive by default.",
        confirmText: "Yes, Restore",
        destructive: false,
    });

    if (!confirmed) return;
    
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, { isArchived: false, isActive: false, updatedAt: serverTimestamp() });
        toast({ title: "Inventory Item Restored" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Restore Failed", description: error.message });
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
        <div className="flex items-center gap-2">
            <Button onClick={handleBackfill} variant="outline" disabled={isBackfilling}>
                {isBackfilling ? <Loader className="animate-spin mr-2"/> : <RefreshCw className="mr-2" />}
                Backfill Data
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <PlusCircle className="mr-2" />
              Add Products to Inventory
            </Button>
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>{showArchived ? "Archived Stock" : "Current Stock"}</CardTitle>
              <CardDescription>{showArchived ? "Archived products. These are hidden from all parts of the app." : "All products currently tracked in this store's inventory."}</CardDescription>
            </div>
             <div className="flex items-center gap-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                    placeholder="Search by name or barcode..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                    />
                </div>
                 {appUser?.isPlatformAdmin && (
                    <div className="flex items-center space-x-2">
                        <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
                        <Label htmlFor="show-archived">Show Archived</Label>
                    </div>
                )}
            </div>
          </div>
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
                        <TableHead colSpan={7} className="text-lg font-semibold text-foreground">
                            {subCategory}
                        </TableHead>
                    </TableRow>
                    <TableRow>
                        <TableHead>Image</TableHead>
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
                        <TableCell>
                            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center relative">
                                {item.imageUrl ? (
                                    <Image src={item.imageUrl} alt={getDisplayName(item)} fill style={{objectFit:"cover"}} className="rounded-md" />
                                ) : (
                                    <Package className="h-6 w-6 text-muted-foreground"/>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="font-medium py-1">{getDisplayName(item)}</TableCell>
                        <TableCell className="py-1">₱{(item.cost || 0).toFixed(2)}</TableCell>
                        <TableCell className="py-1">₱{(item.sellingPrice || 0).toFixed(2)}</TableCell>
                        <TableCell className="py-1">
                          <Switch
                            checked={!!item.isAddon}
                            onCheckedChange={() => handleToggle(item, 'isAddon')}
                            disabled={showArchived}
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          <Badge variant={item.isActive ? "default" : "secondary"}>
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right py-1">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                    {showArchived ? (
                                        <DropdownMenuItem onClick={() => handleRestoreItem(item)} disabled={!appUser?.isPlatformAdmin}>
                                            <RefreshCw className="mr-2 h-4 w-4" /> Restore
                                        </DropdownMenuItem>
                                    ) : (
                                        <>
                                            <DropdownMenuItem onClick={() => { setSelectedItem(item); setIsEditOpen(true); }}>
                                                <Pencil className="mr-2 h-4 w-4" /> Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => handleToggle(item, 'isActive')}>
                                                {item.isActive ? <PowerOff className="mr-2 h-4 w-4 text-destructive" /> : <Power className="mr-2 h-4 w-4" />}
                                                {item.isActive ? 'Deactivate' : 'Activate'}
                                            </DropdownMenuItem>
                                            {appUser?.isPlatformAdmin && (
                                                <>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteItem(item)}>
                                                        <Archive className="mr-2 h-4 w-4" /> Archive
                                                    </DropdownMenuItem>
                                                </>
                                            )}
                                        </>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </React.Fragment>
              ))}
              {Object.keys(groupedInventory).length === 0 && debouncedSearchTerm && (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      No results found for "{debouncedSearchTerm}".
                    </TableCell>
                  </TableRow>
                </TableBody>
              )}
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">{showArchived ? 'No archived items found.' : 'No inventory items found. Click "Add Products" to get started.'}</p>
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

    