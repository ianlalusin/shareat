
"use client";

import { useState, useEffect, useMemo } from "react";
import * as React from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, doc, writeBatch, serverTimestamp, updateDoc, where, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Pencil, Power, PowerOff, Search, RefreshCw, Archive, Package, ArrowLeft, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddInventoryDialog } from "@/components/manager/inventory/add-inventory-dialog";
import { EditInventoryDialog } from "@/components/manager/inventory/edit-inventory-dialog";
import { QuickPriceCell } from "@/components/manager/inventory/quick-price-cell";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import type { InventoryItem, KitchenLocation, Product } from "@/lib/types";
import { normalizeUom } from "@/lib/uom";
import { getDisplayName } from "@/lib/products/variants";
import { scheduleStorefrontAutoPublish, type StorefrontPublishResult } from "@/lib/storefront/auto-publish";
import { scheduleCustomerCatalogAutoPublish, type CustomerCatalogPublishResult } from "@/lib/customer-catalog/auto-publish";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import Image from "next/image";

/**
 * Flip this on once every `catalogItems` entry is either linked and migrated
 * (see scripts/backfill-customer-catalog.ts) or intentionally dropped.
 *
 * `rebuildCustomerCatalog` fully REPLACES `catalogCache/main` from
 * `inventory.customerEnabled`. Until migration is complete, most stores'
 * cache is still populated by the old catalogItems-based system; firing the
 * new builder now would wipe every item that hasn't been migrated yet, not
 * just leave them alone. Toggling `customerEnabled` in the UI before then is
 * safe on its own (it only writes the inventory doc) — it just doesn't
 * publish anywhere until this is turned on.
 */
const CUSTOMER_CATALOG_CUTOVER_LIVE = false;

export default function InventoryManagementPage() {
  const router = useRouter();
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

  // An online price that is SET but not positive withholds the item from the
  // storefront instead of falling back to the store price (see resolvePrice in
  // storefront-catalog). Surface it: a manager who switched an item online
  // would otherwise have no way to tell why it never showed up.
  const withheldByOnlinePrice = (item: InventoryItem): boolean => {
    const raw = item.onlinePrice;
    if (raw === null || raw === undefined) return false;
    const op = Number(raw);
    return !Number.isFinite(op) || op <= 0;
  };

  // Same withholding rule as the online price, applied to the customer app price.
  const withheldByCustomerPrice = (item: InventoryItem): boolean => {
    const raw = item.customerPrice;
    if (raw === null || raw === undefined) return false;
    const cp = Number(raw);
    return !Number.isFinite(cp) || cp <= 0;
  };

  // Republish the public storefront if this store is the storefront pilot store.
  // Inventory price / availability is the snapshot's pricing source, so changing
  // it here must refresh shareat.net/shop (debounced; no-op on other stores).
  const notifyPublish = (r: StorefrontPublishResult) => {
    if (r.ok) toast({ title: "Storefront updated", description: `${r.itemCount} item${r.itemCount === 1 ? "" : "s"} live on the website.` });
    else toast({ variant: "destructive", title: "Storefront auto-publish failed", description: r.error });
  };

  // Republish this store's customer-app catalog cache. Every store publishes
  // its own — there is no single pilot store here, unlike the public storefront.
  const notifyCustomerPublish = (r: CustomerCatalogPublishResult) => {
    if (r.ok) toast({ title: "Customer app updated", description: `${r.itemCount} item${r.itemCount === 1 ? "" : "s"} live on the customer app.` });
    else toast({ variant: "destructive", title: "Customer app auto-publish failed", description: r.error });
  };

  /**
   * Inline table edit of one price field.
   *
   * Throws on failure so QuickPriceCell keeps the manager's typed value on
   * screen instead of silently reverting it. `null` only ever arrives for
   * onlinePrice, the one field where blank is a valid instruction.
   */
  const handleQuickPrice = async (item: InventoryItem, field: 'cost' | 'sellingPrice' | 'onlinePrice' | 'customerPrice', next: number | null) => {
    if (!activeStore || !appUser) return;

    // The edit dialog refuses to leave an add-on without a positive price; the
    // fast path must not become a way around that.
    if (field === 'sellingPrice' && item.isAddon && (next ?? 0) <= 0) {
      toast({
        variant: "destructive",
        title: "Add-ons need a price",
        description: `"${getDisplayName(item)}" is an add-on, so its store price must be greater than 0.`,
      });
      throw new Error("add-on requires a positive selling price");
    }

    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
      await updateDoc(itemDocRef, { [field]: next, updatedAt: serverTimestamp() });
      // Cost is internal and never reaches either channel. sellingPrice feeds
      // both channels' fallback price, so it republishes both.
      if (field === 'sellingPrice' || field === 'onlinePrice') scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
      if (CUSTOMER_CATALOG_CUTOVER_LIVE && (field === 'sellingPrice' || field === 'customerPrice')) scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
      throw error;
    }
  };

  const handleEditItem = async (item: InventoryItem, data: { cost: number; sellingPrice: number; kitchenLocationId: string | null; onlinePrice: number | null; customerPrice: number | null; isAddon: boolean; }) => {
     if (!activeStore || !appUser) return;
    setIsSubmitting(true);
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
        toast({ title: "Item Updated", description: `${getDisplayName(item)} details have been saved.`});
        // The form can touch sellingPrice/onlinePrice/customerPrice together, so
        // republish both channels rather than tracking which fields changed.
        scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
        if (CUSTOMER_CATALOG_CUTOVER_LIVE) scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
    } catch (error: any) {
        toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
        setIsSubmitting(false);
        setIsEditOpen(false);
    }
  };
  
  // `isAddon` is no longer toggled from the table — it moved into the edit
  // dialog, next to the selling price and kitchen location it depends on.
  const handleToggle = async (item: InventoryItem, field: 'isActive' | 'onlineEnabled' | 'customerEnabled') => {
    if (!activeStore || !appUser) return;
    // `onlineEnabled`/`customerEnabled` are opt-in and default to FALSE when
    // absent (see InventoryItem) — this must match the publisher's gate
    // (`x?.onlineEnabled !== true`) or the toggle can show "on" for an item
    // that was never actually published.
    const current = (field === 'onlineEnabled' || field === 'customerEnabled') ? item[field] === true : !!item[field];
    const newStatus = !current;

    const action = newStatus ? "Enable" : "Disable";
    const fieldName = field === 'isActive' ? 'availability' : field === 'onlineEnabled' ? 'online availability' : 'customer app availability';

    const confirmed = await confirm({
        title: `${action} ${getDisplayName(item)}'s ${fieldName}?`,
        confirmText: `Yes, ${action}`,
    });

    if (!confirmed) return;

    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, { [field]: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Item Status Updated" });
        if (field === 'isActive' || field === 'onlineEnabled') scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
        if (CUSTOMER_CATALOG_CUTOVER_LIVE && field === 'customerEnabled') scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
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
        scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
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
            <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
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
                        <TableHead colSpan={9} className="text-lg font-semibold text-foreground">
                            {subCategory}
                        </TableHead>
                    </TableRow>
                    <TableRow>
                        <TableHead className="w-[64px]">Image</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="w-[104px]">Cost</TableHead>
                        <TableHead className="w-[104px]">Store Price</TableHead>
                        <TableHead className="w-[70px]">Online</TableHead>
                        <TableHead className="w-[104px]">Online Price</TableHead>
                        <TableHead className="w-[70px]">Customer</TableHead>
                        <TableHead className="w-[104px]">Customer Price</TableHead>
                        <TableHead className="w-[132px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const label = getDisplayName(item);
                      const online = item.onlineEnabled === true;
                      const customer = item.customerEnabled === true;
                      return (
                      <TableRow key={item.id} className={cn(!item.isActive && !showArchived && "opacity-60")}>
                        <TableCell>
                            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center relative">
                                {item.imageUrl ? (
                                    <Image src={item.imageUrl} alt={label} fill style={{objectFit:"cover"}} className="rounded-md" />
                                ) : (
                                    <Package className="h-6 w-6 text-muted-foreground"/>
                                )}
                            </div>
                        </TableCell>
                        {/* Wraps to two lines rather than stretching the row — the
                            price columns are what this table is scanned for. */}
                        <TableCell className="py-1">
                          <span
                            className="block max-w-[220px] whitespace-normal break-words leading-snug line-clamp-2 font-medium"
                            title={label}
                          >
                            {label}
                          </span>
                        </TableCell>
                        <TableCell className="py-1">
                          <QuickPriceCell
                            value={item.cost}
                            disabled={showArchived}
                            ariaLabel={`Cost for ${label}`}
                            onCommit={(next) => handleQuickPrice(item, 'cost', next)}
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          <QuickPriceCell
                            value={item.sellingPrice}
                            disabled={showArchived}
                            ariaLabel={`Store price for ${label}`}
                            onCommit={(next) => handleQuickPrice(item, 'sellingPrice', next)}
                          />
                        </TableCell>
                        <TableCell className="py-1">
                          <Switch
                            checked={online}
                            onCheckedChange={() => handleToggle(item, 'onlineEnabled')}
                            disabled={showArchived}
                            aria-label={`Offer ${label} on the online store`}
                          />
                        </TableCell>
                        {/* Only meaningful while the item is offered online. */}
                        <TableCell className="py-1">
                          {online ? (
                            <>
                              <QuickPriceCell
                                value={item.onlinePrice}
                                allowEmpty
                                placeholder={String(item.sellingPrice ?? 0)}
                                disabled={showArchived}
                                ariaLabel={`Online price for ${label} — blank matches the store price`}
                                onCommit={(next) => handleQuickPrice(item, 'onlinePrice', next)}
                              />
                              {withheldByOnlinePrice(item) && (
                                <span
                                  className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600"
                                  title="Priced at 0 online, so it stays off the online store. Clear the box to charge the store price instead."
                                >
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Not shown
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1">
                          <Switch
                            checked={customer}
                            onCheckedChange={() => handleToggle(item, 'customerEnabled')}
                            disabled={showArchived}
                            aria-label={`Offer ${label} on the customer app`}
                          />
                        </TableCell>
                        {/* Only meaningful while the item is offered on the customer app. */}
                        <TableCell className="py-1">
                          {customer ? (
                            <>
                              <QuickPriceCell
                                value={item.customerPrice}
                                allowEmpty
                                placeholder={String(item.sellingPrice ?? 0)}
                                disabled={showArchived}
                                ariaLabel={`Customer app price for ${label} — blank matches the store price`}
                                onCommit={(next) => handleQuickPrice(item, 'customerPrice', next)}
                              />
                              {withheldByCustomerPrice(item) && (
                                <span
                                  className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600"
                                  title="Priced at 0 on the customer app, so it stays hidden there. Clear the box to charge the store price instead."
                                >
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Not shown
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-1">
                          <div className="flex items-center justify-end gap-0.5">
                            {showArchived ? (
                              <Button
                                variant="ghost" size="icon" title="Restore"
                                disabled={!appUser?.isPlatformAdmin}
                                onClick={() => handleRestoreItem(item)}
                              >
                                <RefreshCw className="h-4 w-4" />
                                <span className="sr-only">Restore {label}</span>
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost" size="icon"
                                  title={item.isActive ? "Active — click to deactivate" : "Inactive — click to activate"}
                                  onClick={() => handleToggle(item, 'isActive')}
                                >
                                  {item.isActive
                                    ? <Power className="h-4 w-4 text-emerald-600" />
                                    : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                                  <span className="sr-only">{item.isActive ? "Deactivate" : "Activate"} {label}</span>
                                </Button>
                                <Button
                                  variant="ghost" size="icon" title="Edit"
                                  onClick={() => { setSelectedItem(item); setIsEditOpen(true); }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">Edit {label}</span>
                                </Button>
                                {appUser?.isPlatformAdmin && (
                                  <Button
                                    variant="ghost" size="icon" title="Archive"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => handleDeleteItem(item)}
                                  >
                                    <Archive className="h-4 w-4" />
                                    <span className="sr-only">Archive {label}</span>
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </React.Fragment>
              ))}
              {Object.keys(groupedInventory).length === 0 && debouncedSearchTerm && (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
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
            onToggle={handleToggle}
            isSubmitting={isSubmitting}
        />
      )}
      
      {Dialog}
    </RoleGuard>
  );
}
