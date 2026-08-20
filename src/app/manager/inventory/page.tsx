
"use client";

import { useState, useEffect, useMemo } from "react";
import * as React from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, doc, writeBatch, serverTimestamp, updateDoc, where, getDocs, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Pencil, Power, PowerOff, Search, RefreshCw, Archive, Package, ArrowLeft, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { AddInventoryDialog } from "@/components/manager/inventory/add-inventory-dialog";
import { EditInventoryDialog } from "@/components/manager/inventory/edit-inventory-dialog";
import { QuickPriceCell } from "@/components/manager/inventory/quick-price-cell";
import OptionGroupsClient from "@/components/admin/option-groups/OptionGroupsClient";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import type { InventoryItem, KitchenLocation, Product } from "@/lib/types";
import { normalizeUom } from "@/lib/uom";
import { getDisplayName, getEffectiveVariantLabel, groupIntoFamilies } from "@/lib/products/variants";
import { scheduleStorefrontAutoPublish, type StorefrontPublishResult } from "@/lib/storefront/auto-publish";
import { scheduleCustomerCatalogAutoPublish, type CustomerCatalogPublishResult } from "@/lib/customer-catalog/auto-publish";
import { CustomerOrderingSettings } from "@/components/manager/store-settings/customer-ordering-settings";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import Image from "next/image";

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

  /**
   * Global catalog photos, keyed by productId — the other half of the
   * local-overrides-global display rule (`inventoryItem.imageUrl ??
   * product.imageUrl`).
   *
   * `inventory.imageUrl` is a PURE per-store override: null/absent means "this
   * store has no photo of its own", and is deliberately never populated with a
   * copy of the product photo (see handleAddItems / handleBackfill below). So
   * the rows have to join the two collections themselves, or an item the store
   * hasn't photographed shows a blank tile even when the catalog has a picture.
   *
   * One-shot read, not a listener: the global catalog changes rarely and this
   * page is opened many times a day. An admin promoting a photo while this page
   * is already open shows up on the next load. The same fetch already happens
   * on demand in handleBackfill and in the "Add Products" dialog.
   */
  const [productImageById, setProductImageById] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;
    getDocs(collection(db, "products"))
      .then((snapshot) => {
        if (cancelled) return;
        setProductImageById(new Map(snapshot.docs.map((d) => [d.id, (d.data() as Product).imageUrl ?? null])));
      })
      .catch((error) => {
        // Non-fatal: rows fall back to no picture for items with no local
        // photo. Pricing and availability, what this page is actually for, are
        // unaffected, so this must not block the page or nag the manager.
        console.error("Failed to fetch global product photos:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [appUser]);

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

  // Family-grouped for display: variants sharing a groupId nest under one
  // header row, matching the family view already used on admin/menu/products.
  // Each variant keeps its own row and full editing below — this only changes
  // how rows are visually clustered, not what any of them read or write.
  const familyGroupedInventory = useMemo(() => {
    const out: Record<string, ReturnType<typeof groupIntoFamilies<InventoryItem>>> = {};
    for (const subCategory in groupedInventory) {
      out[subCategory] = groupIntoFamilies(groupedInventory[subCategory]);
    }
    return out;
  }, [groupedInventory]);

  // Expanded by default: this page is used many times a day for live pricing
  // and availability work, unlike the occasionally-browsed admin catalog —
  // collapsing families by default would hide info managers see today with
  // zero clicks. The chevron still lets a manager collapse a large family.
  const [collapsedFamilyIds, setCollapsedFamilyIds] = useState<Set<string>>(new Set());
  const toggleFamilyExpanded = (groupId: string) => {
    setCollapsedFamilyIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleBackfill = async () => {
    if (!activeStore || !appUser) return;

    const confirmed = await confirm({
        title: "Backfill Missing Barcodes?",
        description: "This will scan all inventory items and copy missing barcodes from the global product catalog. Photos are not copied — an item with no photo of its own already shows the global catalog photo automatically. Safe to run multiple times.",
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

                // Photos are deliberately NOT backfilled any more. `imageUrl`
                // on an inventory record is a pure per-store override: null
                // means "no photo of our own", and every display surface falls
                // back to products/{id}.imageUrl for it. Copying the global
                // photo in here made every store look like it had deliberately
                // chosen that exact picture, so it then survived an admin
                // replacing or rejecting the global one — the store was stuck
                // on a stale photo nobody could see they had "chosen".

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
            toast({ title: "Backfill Complete", description: `${updatedCount} inventory item(s) were given a missing barcode.` });
        } else {
            toast({ title: "No Updates Needed", description: "Every inventory item already has its barcode." });
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
        // NOT a copy of product.imageUrl. This field is a pure per-store
        // override — null means "this store has no photo of its own", and the
        // row/POS/storefront display falls back to the global catalog photo
        // for it. Seeding it with a copy would freeze the store on whatever
        // the global photo happened to be on the day the item was added.
        imageUrl: null,
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
  const handleQuickPrice = async (item: InventoryItem, field: 'cost' | 'sellingPrice' | 'onlinePrice', next: number | null) => {
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
      // the online fallback price AND is always the customer app's price, so
      // it republishes both; onlinePrice only ever affects the storefront.
      if (field === 'sellingPrice' || field === 'onlinePrice') scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
      if (field === 'sellingPrice') scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
      throw error;
    }
  };

  const handleEditItem = async (item: InventoryItem, data: { cost: number; sellingPrice: number; kitchenLocationId: string | null; onlinePrice: number | null; isAddon: boolean; }) => {
     if (!activeStore || !appUser) return;
    setIsSubmitting(true);
    const itemDocRef = doc(db, "stores", activeStore.id, "inventory", item.id);
    try {
        await updateDoc(itemDocRef, {
            ...data,
            updatedAt: serverTimestamp(),
        });
        toast({ title: "Item Updated", description: `${getDisplayName(item)} details have been saved.`});
        // The form can touch sellingPrice/onlinePrice together, and sellingPrice
        // is always the customer app's price too, so republish both channels.
        scheduleStorefrontAutoPublish(activeStore.id, notifyPublish);
        scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
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
        if (field === 'customerEnabled') scheduleCustomerCatalogAutoPublish(activeStore.id, notifyCustomerPublish);
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

  /**
   * One inventory row. Used both for standalone items and for a family's
   * nested variants — `indent` only changes the label/image treatment
   * (matching admin/menu/products' `↳ variantLabel` convention). Every
   * field/handler below still reads and writes this exact `item`, so a
   * variant's price, cost, and Online/Customer toggles never touch its
   * siblings regardless of how the rows are visually clustered.
   */
  const renderItemRow = (item: InventoryItem, indent = false) => {
    const displayLabel = indent ? `↳ ${getEffectiveVariantLabel(item) || item.name}` : getDisplayName(item);
    const ariaLabel = getDisplayName(item);
    // The store's own photo wins; otherwise show the global catalog photo.
    const effectiveImageUrl = item.imageUrl ?? productImageById.get(item.productId) ?? null;
    const online = item.onlineEnabled === true;
    const customer = item.customerEnabled === true;
    return (
      <TableRow key={item.id} className={cn(!item.isActive && !showArchived && "opacity-60", indent && "bg-muted/20")}>
        <TableCell>
            <div className={cn("rounded-md bg-muted flex items-center justify-center relative", indent ? "ml-6 w-10 h-10" : "w-12 h-12")}>
                {effectiveImageUrl ? (
                    <Image src={effectiveImageUrl} alt={ariaLabel} fill style={{objectFit:"cover"}} className="rounded-md" />
                ) : (
                    <Package className={cn("text-muted-foreground", indent ? "h-5 w-5" : "h-6 w-6")}/>
                )}
            </div>
        </TableCell>
        {/* Wraps to two lines rather than stretching the row — the
            price columns are what this table is scanned for. */}
        <TableCell className="py-1">
          <span
            className={cn("block max-w-[220px] whitespace-normal break-words leading-snug line-clamp-2 font-medium", indent && "pl-2 text-sm")}
            title={ariaLabel}
          >
            {displayLabel}
          </span>
        </TableCell>
        <TableCell className="py-1">
          <QuickPriceCell
            value={item.cost}
            disabled={showArchived}
            ariaLabel={`Cost for ${ariaLabel}`}
            onCommit={(next) => handleQuickPrice(item, 'cost', next)}
          />
        </TableCell>
        <TableCell className="py-1">
          <QuickPriceCell
            value={item.sellingPrice}
            disabled={showArchived}
            ariaLabel={`Store price for ${ariaLabel}`}
            onCommit={(next) => handleQuickPrice(item, 'sellingPrice', next)}
          />
        </TableCell>
        <TableCell className="py-1">
          <Switch
            checked={online}
            onCheckedChange={() => handleToggle(item, 'onlineEnabled')}
            disabled={showArchived}
            aria-label={`Offer ${ariaLabel} on the online store`}
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
                ariaLabel={`Online price for ${ariaLabel} — blank matches the store price`}
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
            aria-label={`Offer ${ariaLabel} on the customer app`}
          />
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
                <span className="sr-only">Restore {ariaLabel}</span>
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
                  <span className="sr-only">{item.isActive ? "Deactivate" : "Activate"} {ariaLabel}</span>
                </Button>
                <Button
                  variant="ghost" size="icon" title="Edit"
                  onClick={() => { setSelectedItem(item); setIsEditOpen(true); }}
                >
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">Edit {ariaLabel}</span>
                </Button>
                {appUser?.isPlatformAdmin && (
                  <Button
                    variant="ghost" size="icon" title="Archive"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteItem(item)}
                  >
                    <Archive className="h-4 w-4" />
                    <span className="sr-only">Archive {ariaLabel}</span>
                  </Button>
                )}
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  /** Family header row: chevron, name, variant count, and a rollup so "may vary" is visible without expanding. */
  const renderFamilyHeaderRow = (row: Extract<ReturnType<typeof groupIntoFamilies<InventoryItem>>[number], { kind: "family" }>) => {
    const expanded = !collapsedFamilyIds.has(row.groupId);
    const activePrices = row.variants
      .filter((v) => v.isActive)
      .map((v) => Number(v.sellingPrice))
      .filter((p) => Number.isFinite(p) && p > 0);
    const minPrice = activePrices.length ? Math.min(...activePrices) : null;
    const maxPrice = activePrices.length ? Math.max(...activePrices) : null;
    const onlineCount = row.variants.filter((v) => v.onlineEnabled === true).length;
    const customerCount = row.variants.filter((v) => v.customerEnabled === true).length;
    return (
      <TableRow key={`family-${row.groupId}`} className="bg-muted/40 hover:bg-muted/50">
        <TableCell colSpan={8} className="py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => toggleFamilyExpanded(row.groupId)}
              aria-label={expanded ? `Collapse ${row.groupName}` : `Expand ${row.groupName}`}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </Button>
            <span className="font-semibold">{row.groupName}</span>
            <Badge variant="outline" className="text-xs">Family · {row.variants.length}</Badge>
            {minPrice != null && (
              <span className="text-xs text-muted-foreground">
                {minPrice === maxPrice ? `₱${minPrice.toLocaleString()}` : `₱${minPrice.toLocaleString()} – ₱${maxPrice!.toLocaleString()}`}
              </span>
            )}
            <Badge variant="secondary" className="text-[11px]">Online {onlineCount}/{row.variants.length}</Badge>
            <Badge variant="secondary" className="text-[11px]">Customer {customerCount}/{row.variants.length}</Badge>
          </div>
        </TableCell>
      </TableRow>
    );
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
      <PageHeader title="Menu" description={`Manage products, pricing, and availability for ${activeStore.name}`}>
        <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
        </div>
      </PageHeader>
      <Tabs defaultValue="main-menu">
        <TabsList className="mb-4">
          <TabsTrigger value="main-menu">Main Menu</TabsTrigger>
          <TabsTrigger value="menu-options">Menu Options</TabsTrigger>
        </TabsList>

        <TabsContent value="main-menu">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <CustomerOrderingSettings variant="inline" />
            <Button onClick={handleBackfill} variant="outline" disabled={isBackfilling}>
                {isBackfilling ? <Loader className="animate-spin mr-2"/> : <RefreshCw className="mr-2" />}
                Backfill Barcodes
            </Button>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <PlusCircle className="mr-2" />
              Add Products to Inventory
            </Button>
      </div>
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
              {Object.entries(familyGroupedInventory).map(([subCategory, rows]) => (
                <React.Fragment key={subCategory}>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                        <TableHead colSpan={8} className="text-lg font-semibold text-foreground">
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
                        <TableHead className="w-[132px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      if (row.kind === "single") {
                        return renderItemRow(row.item);
                      }
                      const expanded = !collapsedFamilyIds.has(row.groupId);
                      return (
                        <React.Fragment key={`family-${row.groupId}`}>
                          {renderFamilyHeaderRow(row)}
                          {expanded && row.variants.map((v) => renderItemRow(v, true))}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </React.Fragment>
              ))}
              {Object.keys(familyGroupedInventory).length === 0 && debouncedSearchTerm && (
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
        </TabsContent>

        <TabsContent value="menu-options">
          <OptionGroupsClient />
        </TabsContent>
      </Tabs>

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
            storeId={activeStore!.id}
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
