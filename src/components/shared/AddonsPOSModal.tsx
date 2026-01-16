
"use client";

import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Minus, Plus, Loader2, Layers } from "lucide-react";
import Image from "next/image";
import { useIsMobile } from "@/hooks/use-mobile";
import { collection, doc, writeBatch, serverTimestamp, runTransaction, increment } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { ScrollArea } from "../ui/scroll-area";
import { stripUndefined } from "@/lib/firebase/utils";
import type { InventoryItem, PendingSession, SessionBillLine } from "@/lib/types";
import { computeSessionLabel } from "@/lib/utils/session";
import { QuantityInput } from "../cashier/quantity-input";
import { allowsDecimalQty } from "@/lib/uom";
import { getActorStamp } from "../cashier/firestore";

interface AddonsPOSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
  onAddLine?: (line: SessionBillLine) => void;
}

type EnrichedStoreAddon = InventoryItem & {
  displayName: string;
  groupKey: string;
  groupName?: string;
  imageUrl?: string | null;
};

type AddonGroup = {
  title: string;
  key: string;
  items: EnrichedStoreAddon[];
  isGroup: boolean;
};

function AddonItem({ addon, onSelect }: { addon: EnrichedStoreAddon; onSelect: (addon: EnrichedStoreAddon) => void }) {
  return (
    <button
      onClick={() => onSelect(addon)}
      className="flex flex-col items-center justify-center p-2 border rounded-md hover:bg-muted/50 transition-colors text-center h-32 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="w-16 h-16 bg-muted rounded-md mb-1 relative overflow-hidden">
        {addon.imageUrl && <Image src={addon.imageUrl} alt={addon.displayName} fill style={{ objectFit: "cover" }} />}
      </div>
      <span className="text-xs font-medium leading-tight line-clamp-2">{addon.displayName}</span>
      <span className="text-xs text-muted-foreground mt-auto">₱{(addon.sellingPrice || 0).toFixed(2)}</span>
    </button>
  );
}

function GroupTile({ group, onSelect }: { group: AddonGroup; onSelect: (group: AddonGroup) => void }) {
  return (
    <button
      onClick={() => onSelect(group)}
      className="flex flex-col items-center justify-center p-2 border rounded-md hover:bg-muted/50 transition-colors text-center h-32 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="w-16 h-16 bg-muted rounded-md mb-1 relative overflow-hidden flex items-center justify-center">
        {group.items[0].imageUrl ? (
          <Image src={group.items[0].imageUrl} alt={group.title} fill style={{ objectFit: "cover" }} />
        ) : (
          <Layers className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <span className="text-xs font-medium leading-tight line-clamp-2">{group.title}</span>
      <span className="text-xs text-primary mt-auto">Choose variant</span>
    </button>
  );
}

function VariantPicker({
  group,
  open,
  onOpenChange,
  onSelectVariant,
}: {
  group: AddonGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectVariant: (addon: EnrichedStoreAddon) => void;
}) {
  if (!group) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Select Variant: {group.title}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 py-4">
          {group.items.map((addon) => (
            <AddonItem
              key={addon.id}
              addon={addon}
              onSelect={() => {
                onSelectVariant(addon);
                onOpenChange(false);
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function POSContent({
  storeId,
  session,
  sessionIsLocked,
  onClose,
  onAddLine,
}: {
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
  onClose: () => void;
  onAddLine?: (line: SessionBillLine) => void;
}) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();

  // Addons now come from StoreContext cache (loaded once per activeStore).
  const { storeAddons, storeAddonsLoading, refreshStoreAddons } = useStoreContext();
  const addons = storeAddons as unknown as EnrichedStoreAddon[];
  const isLoading = storeAddonsLoading;

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  const [selectedAddon, setSelectedAddon] = useState<EnrichedStoreAddon | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [variantPickerGroup, setVariantPickerGroup] = useState<AddonGroup | null>(null);
  const [isVariantPickerOpen, setIsVariantPickerOpen] = useState(false);

  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(addons.map((a) => a.subCategory || "Uncategorized")))];
  }, [addons]);

  const groupedAddons = useMemo(() => {
    let result = addons;

    if (activeCategory !== "All") {
      result = result.filter((a) => (a.subCategory || "Uncategorized") === activeCategory);
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((a) => (a.displayName || "").toLowerCase().includes(s));
    }

    const groups: Record<string, AddonGroup> = {};
    result.forEach((addon) => {
      const key = addon.groupKey || addon.id;
      if (!groups[key]) {
        groups[key] = {
          key,
          title: addon.groupName || addon.name,
          items: [],
          isGroup: false,
        };
      }
      groups[key].items.push(addon);
    });

    return Object.values(groups)
      .map((group) => {
        const isGroup = group.items.length > 1;
        return { ...group, isGroup };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [addons, search, activeCategory]);

  const handleSelectAddon = (addon: EnrichedStoreAddon) => {
    setSelectedAddon(addon);
    setQuantity(1);
  };

  const handleSelectGroup = (group: AddonGroup) => {
    setVariantPickerGroup(group);
    setIsVariantPickerOpen(true);
  };

  const handleAddToOrder = async () => {
    if (!appUser || !storeId || !session?.id || !selectedAddon) {
      toast({ variant: "destructive", title: "Cannot Add Item", description: "Missing user, store, or session context." });
      return;
    }
    if (sessionIsLocked) {
      toast({ variant: "destructive", title: "Cannot Add Item", description: "This session is locked and cannot be modified." });
      return;
    }
    if (!selectedAddon.kitchenLocationId) {
      toast({
        variant: "destructive",
        title: "Kitchen Not Assigned",
        description: `"${selectedAddon.displayName}" has no kitchen location assigned.`,
      });
      return;
    }

    const unitPriceNum = Number((selectedAddon as any).sellingPrice);
    const safeUnitPrice = Number.isFinite(unitPriceNum) ? unitPriceNum : 0;
    if (safeUnitPrice <= 0) {
      toast({ variant: "destructive", title: "Invalid Price", description: `Cannot add "${selectedAddon.displayName}" with a price of zero.`});
      return;
    }

    // If onAddLine is provided, we're in "edit receipt" mode.
    if (onAddLine) {
        const newLine: SessionBillLine = {
            id: `addon_${selectedAddon.id}`, // Stable ID for merging quantities
            type: "addon",
            itemId: selectedAddon.id,
            itemName: selectedAddon.displayName,
            category: selectedAddon.subCategory ?? null,
            barcode: selectedAddon.barcode ?? null,
            unitPrice: safeUnitPrice,
            qtyOrdered: quantity,
            discountType: null,
            discountValue: 0,
            discountQty: 0,
            freeQty: 0,
            voidedQty: 0,
            createdAt: new Date(), // Temporary, won't be saved to Firestore directly
            updatedAt: new Date(),
        };
        onAddLine(newLine);
        toast({ title: "Added", description: `${selectedAddon.displayName} x${quantity} added to bill.` });
        setSelectedAddon(null);
        setQuantity(1);
        onClose();
        return;
    }


    setIsSubmitting(true);

    try {
      const lineId = `addon_${selectedAddon.id}`;
      const lineRef = doc(db, `stores/${storeId}/sessions/${session.id}/sessionBillLines`, lineId);
      const ticketsColRef = collection(db, `stores/${storeId}/sessions/${session.id}/kitchentickets`);
      const actor = getActorStamp(appUser);
      
      await runTransaction(db, async (tx) => {
        // 1. Upsert the billable line item
        const lineSnap = await tx.get(lineRef);
        if (lineSnap.exists()) {
          tx.update(lineRef, {
            qtyOrdered: increment(quantity),
            updatedAt: serverTimestamp(),
            updatedByUid: actor.uid,
            updatedByName: actor.username,
          });
        } else {
          const newLine: Omit<SessionBillLine, "id" | "createdAt"> = {
            type: "addon",
            itemId: selectedAddon.id,
            itemName: selectedAddon.displayName,
            category: selectedAddon.subCategory ?? null,
            barcode: selectedAddon.barcode ?? null,
            unitPrice: safeUnitPrice,
            qtyOrdered: quantity,
            discountType: null,
            discountValue: 0,
            discountQty: 0,
            freeQty: 0,
            voidedQty: 0,
            updatedAt: serverTimestamp(),
            updatedByUid: actor.uid,
            updatedByName: actor.username,
          };
          tx.set(lineRef, { ...newLine, id: lineRef.id, createdAt: serverTimestamp() });
        }

        // 2. Create kitchen tickets
        for (let i = 0; i < quantity; i++) {
          const ticketRef = doc(ticketsColRef);
          const ticketPayload = stripUndefined({
            id: ticketRef.id,
            type: "addon",
            itemId: selectedAddon.id,
            itemName: selectedAddon.displayName,
            qty: 1,
            status: "preparing",
            kitchenLocationId: selectedAddon.kitchenLocationId,
            kitchenLocationName: selectedAddon.kitchenLocationName,
            sessionId: session.id,
            storeId,
            createdByUid: appUser.uid,
            createdAt: serverTimestamp(),
            sessionLabel: computeSessionLabel(session),
          });
          tx.set(ticketRef, ticketPayload);
        }
      });
      
      toast({ title: "Added", description: `${selectedAddon.displayName} x${quantity} added.` });
      setSelectedAddon(null);
      setQuantity(1);
      onClose();

    } catch (e: any) {
      console.error("[AddonsPOSModal] add failed:", e);
      toast({ variant: "destructive", title: "Failed", description: "Could not add add-on to order. " + e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <VariantPicker
        group={variantPickerGroup}
        open={isVariantPickerOpen}
        onOpenChange={setIsVariantPickerOpen}
        onSelectVariant={(addon) => handleSelectAddon(addon)}
      />

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative w-full">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search add-ons..."
              className="pl-8"
            />
          </div>
          <Button variant="outline" onClick={refreshStoreAddons} disabled={isLoading}>
            Refresh
          </Button>
        </div>

        <ScrollArea className="h-[55vh] pr-2">
          <div className="flex flex-wrap gap-2 pb-3">
            {categories.map((cat) => (
              <Badge
                key={cat}
                variant={activeCategory === cat ? "default" : "secondary"}
                className="cursor-pointer"
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </Badge>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading add-ons...
            </div>
          ) : groupedAddons.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">No add-ons found.</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {groupedAddons.map((group) =>
                group.isGroup ? (
                  <GroupTile key={group.key} group={group} onSelect={handleSelectGroup} />
                ) : (
                  <AddonItem key={group.items[0].id} addon={group.items[0]} onSelect={handleSelectAddon} />
                )
              )}
            </div>
          )}
        </ScrollArea>

        <div className="border-t pt-3 space-y-2">
          <div className="text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selected</span>
              <span className="font-medium">{selectedAddon ? selectedAddon.displayName : "-"}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={!selectedAddon || isSubmitting}
            >
              <Minus className="h-4 w-4" />
            </Button>

            <QuantityInput
              value={quantity}
              onChange={setQuantity}
              disabled={!selectedAddon || isSubmitting}
              allowsDecimal={selectedAddon ? allowsDecimalQty(selectedAddon.uom) : false}
            />

            <Button
              variant="outline"
              size="icon"
              onClick={() => setQuantity((q) => q + 1)}
              disabled={!selectedAddon || isSubmitting}
            >
              <Plus className="h-4 w-4" />
            </Button>

            <Button className="ml-auto" onClick={handleAddToOrder} disabled={!selectedAddon || isSubmitting || isLoading}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add to Order
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export function AddonsPOSModal({ open, onOpenChange, storeId, session, sessionIsLocked, onAddLine }: AddonsPOSModalProps) {
  const isMobile = useIsMobile();

  const content = (
    <POSContent
      storeId={storeId}
      session={session}
      sessionIsLocked={sessionIsLocked}
      onClose={() => onOpenChange(false)}
      onAddLine={onAddLine}
    />
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add-ons</DrawerTitle>
            <DrawerDescription>Select add-on items to add to the order.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">{content}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add-ons</DialogTitle>
          <DialogDescription>Select add-on items to add to the order.</DialogDescription>
        </DialogHeader>
        {content}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
