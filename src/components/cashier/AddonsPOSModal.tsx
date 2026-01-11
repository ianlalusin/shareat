

"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Minus, Plus, Loader2, ScanLine, Layers } from "lucide-react";
import Image from "next/image";
import { useIsMobile } from "@/hooks/use-mobile";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, getDoc, orderBy, limit, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { ScrollArea } from "../ui/scroll-area";
import { stripUndefined } from "@/lib/firebase/utils";
import type { Product, StoreAddon, PendingSession, BillableLine } from "@/lib/types";
import { SingleScanBarcodeScanner } from "../shared/SingleScanBarcodeScanner";
import { computeSessionLabel } from "@/lib/utils/session";
import { QuantityInput } from "./quantity-input";
import { allowsDecimalQty } from "@/lib/uom";
import { upsertAddonToBill } from "./firestore";
import { getDisplayName, getGroupKey } from "@/lib/products/variants";

interface AddonsPOSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
}

type EnrichedStoreAddon = StoreAddon & {
    displayName: string;
    groupKey: string;
    groupTitle: string;
    kind?: Product['kind'];
    variantLabel?: string | null;
};

type AddonGroup = {
    title: string;
    key: string;
    items: EnrichedStoreAddon[];
    isGroup: boolean; // True if it should open a variant picker
}

function AddonItem({ addon, onSelect }: { addon: EnrichedStoreAddon, onSelect: (addon: EnrichedStoreAddon) => void }) {
  return (
    <button
      onClick={() => onSelect(addon)}
      className="flex flex-col items-center justify-center p-2 border rounded-md hover:bg-muted/50 transition-colors text-center h-32 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="w-16 h-16 bg-muted rounded-md mb-1 relative overflow-hidden">
        {addon.imageUrl && (
          <Image src={addon.imageUrl} alt={addon.displayName} layout="fill" objectFit="cover" />
        )}
      </div>
      <span className="text-xs font-medium leading-tight line-clamp-2">{addon.displayName}</span>
      <span className="text-xs text-muted-foreground mt-auto">₱{(addon.price || 0).toFixed(2)}</span>
    </button>
  );
}

function GroupTile({ group, onSelect }: { group: AddonGroup, onSelect: (group: AddonGroup) => void }) {
  return (
    <button
      onClick={() => onSelect(group)}
      className="flex flex-col items-center justify-center p-2 border rounded-md hover:bg-muted/50 transition-colors text-center h-32 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="w-16 h-16 bg-muted rounded-md mb-1 relative overflow-hidden flex items-center justify-center">
        {group.items[0].imageUrl ? (
          <Image src={group.items[0].imageUrl} alt={group.title} layout="fill" objectFit="cover" />
        ) : <Layers className="h-8 w-8 text-muted-foreground"/> }
      </div>
      <span className="text-xs font-medium leading-tight line-clamp-2">{group.title}</span>
      <span className="text-xs text-primary mt-auto">Choose variant</span>
    </button>
  )
}

function VariantPicker({ 
    group, 
    open, 
    onOpenChange,
    onSelectVariant 
}: { 
    group: AddonGroup | null,
    open: boolean, 
    onOpenChange: (open: boolean) => void,
    onSelectVariant: (addon: EnrichedStoreAddon) => void 
}) {
    if (!group) return null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Select Variant: {group.title}</DialogTitle>
                </DialogHeader>
                 <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 py-4">
                    {group.items.map(addon => (
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
    )
}

function POSContent({
    storeId, 
    session, 
    sessionIsLocked, 
    onClose
}: {
    storeId: string;
    session: PendingSession;
    sessionIsLocked?: boolean;
    onClose: () => void;
}) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [addons, setAddons] = useState<EnrichedStoreAddon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  
  const [selectedAddon, setSelectedAddon] = useState<EnrichedStoreAddon | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  
  const [variantPickerGroup, setVariantPickerGroup] = useState<AddonGroup | null>(null);

  useEffect(() => {
    if (!storeId) {
        setIsLoading(false);
        return;
    };
    const addonsQuery = query(
        collection(db, "stores", storeId, "storeAddons"),
        where("isEnabled", "==", true),
        where("isArchived", "==", false),
        orderBy("sortOrder", "asc"),
        orderBy("name", "asc")
    );

    const unsub = onSnapshot(addonsQuery, async (snapshot) => {
        const storeAddonsData = snapshot.docs.map(d => ({...d.data(), id: d.id}) as StoreAddon);

        const addonsWithDetails = await Promise.all(storeAddonsData.map(async (addon) => {
            let productData: Product | null = null;
            try {
                const productDoc = await getDoc(doc(db, "products", addon.id));
                if (productDoc.exists()) {
                    productData = productDoc.data() as Product;
                }
            } catch (e) {
                console.error("Error fetching product details for addon:", addon.id, e);
            }
            
            const name = productData?.name || addon.name;

            return { 
              ...addon,
              name: name,
              kind: productData?.kind,
              groupId: productData?.groupId,
              groupName: productData?.groupName,
              variantLabel: productData?.variantLabel,
              displayName: getDisplayName(productData || addon),
              groupKey: getGroupKey(productData || addon),
              groupTitle: productData?.groupName || name,
              uom: productData?.uom || addon.uom,
              imageUrl: productData?.imageUrl || addon.imageUrl,
              barcode: productData?.barcode || undefined,
            } as EnrichedStoreAddon;
        }));

        setAddons(addonsWithDetails);
        setIsLoading(false);
    }, (error) => {
        console.error("[AddonsPOSModal] Query error:", error);
        toast({ variant: 'destructive', title: "Load Failed", description: "Could not fetch add-on items."});
        setIsLoading(false);
    });

    return () => unsub();
  }, [storeId, toast]);
  
  const categories = useMemo(() => {
    return ["All", ...Array.from(new Set(addons.map(a => a.category || "Uncategorized")))];
  }, [addons]);
  
  const groupedAddons = useMemo(() => {
    let result = addons;
    if (activeCategory !== "All") {
      result = result.filter(a => (a.category || "Uncategorized") === activeCategory);
    }
    if (search) {
      result = result.filter(a => a.displayName.toLowerCase().includes(search.toLowerCase()));
    }
    
    const groups: Record<string, AddonGroup> = {};

    result.forEach(addon => {
        const key = addon.groupKey;
        if (!groups[key]) {
            groups[key] = {
                key: key,
                title: addon.groupTitle,
                items: [],
                isGroup: false,
            };
        }
        groups[key].items.push(addon);
    });
    
    return Object.values(groups).map(group => {
        // A group is a 'group' if it has multiple items, or its single item is a variant.
        const isGroup = group.items.length > 1 || (group.items.length === 1 && group.items[0].kind === 'variant');
        return { ...group, isGroup };
    });

  }, [addons, search, activeCategory]);

  const handleSelectAddon = (addon: EnrichedStoreAddon) => {
    setSelectedAddon(addon);
    setQuantity(1);
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
        toast({ variant: "destructive", title: "Kitchen Not Assigned", description: `"${selectedAddon.name}" has no kitchen location assigned.`});
        return;
    }

    setIsSubmitting(true);
    
    try {
        const batch = writeBatch(db);
        const ticketsColRef = collection(db, `stores/${storeId}/sessions/${session.id}/kitchentickets`);
        
        for (let i = 0; i < quantity; i++) {
            const ticketRef = doc(ticketsColRef);

            const ticketPayload = stripUndefined({
                id: ticketRef.id,
                type: "addon",
                itemName: selectedAddon.displayName,
                qty: 1,
                uom: selectedAddon.uom,
                kitchenLocationId: selectedAddon.kitchenLocationId,
                kitchenLocationName: selectedAddon.kitchenLocationName,
                status: "preparing",
                createdAt: serverTimestamp(),
                createdByUid: appUser.uid,
                sessionId: session.id, 
                storeId,
                tableNumber: session.tableNumber,
                customerName: session.customer?.name || session.customerName,
                sessionMode: session.sessionMode,
                sessionLabel: computeSessionLabel(session),
                guestCount: session.guestCountFinal || session.guestCountCashierInitial,
                billing: {
                    isVoided: false,
                    isFree: false,
                    itemId: selectedAddon.id,
                    itemName: selectedAddon.displayName,
                    unitPrice: selectedAddon.price || 0,
                }
            });
            batch.set(ticketRef, ticketPayload);
        }

        // Upsert the billable line item
        await upsertAddonToBill(storeId, session.id, selectedAddon, quantity, appUser);

        await batch.commit();

        toast({ title: "Added to Order", description: `${quantity}x ${selectedAddon.displayName} sent to kitchen.`});
        setSelectedAddon(null);
    } catch(e: any) {
        console.error("Order Failed:", e);
        toast({ variant: 'destructive', title: "Order Failed", description: e.message || "An unexpected error occurred." });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleBarcodeScanned = async (code: string) => {
    setIsScannerOpen(false);

    const foundAddon = addons.find(addon => addon.barcode === code);
    
    if (foundAddon) {
        handleSelectAddon(foundAddon);
        toast({ title: "Item Found", description: `Selected: ${foundAddon.displayName}`});
    } else {
        toast({ variant: "destructive", title: "Not Found", description: "No add-on with this barcode was found in the store's active items."});
    }
  };

  const allowDecimal = selectedAddon ? allowsDecimalQty(selectedAddon.uom) : false;
  const qtyStep = allowDecimal ? 0.1 : 1;
  const qtyMin = allowDecimal ? 0.1 : 1;

  return (
    <>
    <div className="flex flex-col h-[80vh] sm:h-[70vh]">
        <div className="p-4 border-b">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9"/>
                </div>
                <Button variant="outline" onClick={() => setIsScannerOpen(true)}><ScanLine className="mr-2"/> Scan Item</Button>
            </div>
            <ScrollArea className="w-full mt-2">
                 <div className="flex space-x-2 pb-2">
                    {categories.map(cat => (
                        <Badge
                            key={cat}
                            variant={activeCategory === cat ? "default" : "secondary"}
                            onClick={() => setActiveCategory(cat)}
                            className="cursor-pointer whitespace-nowrap"
                        >
                            {cat}
                        </Badge>
                    ))}
                </div>
            </ScrollArea>
        </div>
        <ScrollArea className="flex-1 p-4">
            {isLoading ? <Loader2 className="mx-auto my-16 animate-spin"/> : (
                 <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {groupedAddons.map(group => {
                        if (group.isGroup) {
                            return <GroupTile key={group.key} group={group} onSelect={() => setVariantPickerGroup(group)} />
                        } else {
                            return <AddonItem key={group.key} addon={group.items[0]} onSelect={handleSelectAddon} />
                        }
                    })}
                </div>
            )}
            {groupedAddons.length === 0 && !isLoading && (
                 <p className="text-center text-muted-foreground py-10">No add-ons available.</p>
            )}
        </ScrollArea>
        {selectedAddon && (
             <div className="p-4 border-t bg-muted/50">
                <div className="flex justify-between items-center">
                    <div>
                        <p className="font-semibold">{selectedAddon.displayName}</p>
                        <p className="text-sm text-muted-foreground">₱{(selectedAddon.price || 0).toFixed(2)}</p>
                    </div>
                     <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.max(qtyMin, q - qtyStep))}><Minus/></Button>
                        <QuantityInput 
                            value={quantity} 
                            onChange={setQuantity}
                            className="w-20 h-8 text-center" 
                            allowDecimal={allowDecimal}
                        />
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => q + qtyStep)}><Plus/></Button>
                     </div>
                     <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedAddon(null)}>Cancel</Button>
                        <Button size="sm" onClick={handleAddToOrder} disabled={isSubmitting || quantity <= 0 || !selectedAddon.kitchenLocationId || sessionIsLocked}>
                           {isSubmitting ? <Loader2 className="animate-spin" /> : `Add (₱${((selectedAddon.price || 0) * quantity).toFixed(2)})`}
                        </Button>
                     </div>
                </div>
            </div>
        )}
        <div className="p-4 border-t">
            <Button onClick={onClose} className="w-full">Done</Button>
        </div>
    </div>
    <SingleScanBarcodeScanner 
        open={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleBarcodeScanned}
    />
    <VariantPicker
        open={!!variantPickerGroup}
        onOpenChange={(isOpen) => !isOpen && setVariantPickerGroup(null)}
        group={variantPickerGroup}
        onSelectVariant={handleSelectAddon}
    />
    </>
  )
}


export function AddonsPOSModal(props: AddonsPOSModalProps) {
  const isMobile = useIsMobile();
  
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      props.onOpenChange(false);
    }
  };

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add Item</DrawerTitle>
            <DrawerDescription>Select items to add to the order.</DrawerDescription>
          </DrawerHeader>
          <POSContent {...props} onClose={() => props.onOpenChange(false)} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Add Item</DialogTitle>
            <DialogDescription>Select items to add to the order.</DialogDescription>
          </DialogHeader>
          <POSContent {...props} onClose={() => props.onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

  

    

    
