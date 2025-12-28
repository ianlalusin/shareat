
"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Minus, Plus, Loader2 } from "lucide-react";
import Image from "next/image";
import { useIsMobile } from "@/hooks/use-mobile";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, getDoc, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { ScrollArea } from "../ui/scroll-area";
import type { StoreAddon } from "../manager/store-settings/addons-settings";
import type { PendingSession } from "../server/pending-tables";
import { stripUndefined } from "@/lib/firebase/utils";
import { Product } from "@/app/admin/menu/products/page";

interface AddonsPOSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
}

function AddonItem({ addon, onSelect }: { addon: StoreAddon, onSelect: (addon: StoreAddon) => void }) {
  const displayName = addon.name || '(Unnamed)';
  return (
    <button
      onClick={() => onSelect(addon)}
      className="flex flex-col items-center justify-center p-2 border rounded-md hover:bg-muted/50 transition-colors text-center h-32 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="w-16 h-16 bg-muted rounded-md mb-1 relative overflow-hidden">
        {addon.imageUrl && (
          <Image src={addon.imageUrl} alt={displayName} layout="fill" objectFit="cover" />
        )}
      </div>
      <span className="text-xs font-medium leading-tight line-clamp-2">{displayName}</span>
      <span className="text-xs text-muted-foreground mt-auto">₱{(addon.price || 0).toFixed(2)}</span>
    </button>
  );
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
  const [addons, setAddons] = useState<StoreAddon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  
  const [selectedAddon, setSelectedAddon] = useState<StoreAddon | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

        const addonsWithImages = await Promise.all(storeAddonsData.map(async (addon) => {
            if (addon.imageUrl) {
                return addon;
            }
            try {
                const productDoc = await getDoc(doc(db, "products", addon.id));
                if (productDoc.exists()) {
                    const productData = productDoc.data();
                    return { ...addon, imageUrl: productData.imageUrl || null };
                }
            } catch (e) {
                console.error("Error fetching product image for addon:", addon.id, e);
            }
            return { ...addon, imageUrl: undefined }; // Ensure imageUrl is at least undefined
        }));

        setAddons(addonsWithImages);
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
  
  const filteredAddons = useMemo(() => {
    let result = addons;
    if (activeCategory !== "All") {
      result = result.filter(a => (a.category || "Uncategorized") === activeCategory);
    }
    if (search) {
      result = result.filter(a => a.name.toLowerCase().includes(search.toLowerCase()));
    }
    return result;
  }, [addons, search, activeCategory]);

  const handleSelectAddon = (addon: StoreAddon) => {
    setSelectedAddon(addon);
    setQuantity(1);
  };
  
  const handleAddToOrder = async () => {
    if (!appUser || !storeId || !session?.id) {
        toast({ variant: "destructive", title: "Cannot Add Item", description: "Missing user, store, or session context." });
        return;
    }
    if (!selectedAddon) {
        toast({ variant: "destructive", title: "No Item Selected", description: "Please select an item to add." });
        return;
    }
     if (sessionIsLocked) {
        toast({ variant: "destructive", title: "Cannot Add Item", description: "This session is locked and cannot be modified." });
        return;
    }
    
    if (!selectedAddon.kitchenLocationId) {
        console.warn(`Ordering blocked for addon ID ${selectedAddon.id}: missing kitchenLocationId.`);
        toast({
            variant: "destructive",
            title: "Kitchen Not Assigned",
            description: `"${selectedAddon.name}" has no kitchen location assigned. Please configure it in Store Settings.`
        });
        return;
    }

    setIsSubmitting(true);
    
    const batch = writeBatch(db);
    try {
        
        for (let i = 0; i < quantity; i++) {
            const ticketRef = doc(collection(db, "stores", storeId, "sessions", session.id, "kitchentickets"));
            const billableRef = doc(collection(db, "stores", storeId, "sessions", session.id, "billables"), ticketRef.id);
            const itemName = selectedAddon.name;

            const ticketPayload = stripUndefined({
                id: ticketRef.id,
                type: "addon",
                itemName: itemName,
                qty: 1, // Always 1 for a new ticket
                kitchenLocationId: selectedAddon.kitchenLocationId,
                kitchenLocationName: selectedAddon.kitchenLocationName,
                status: "preparing",
                createdAt: serverTimestamp(),
                createdByUid: appUser.uid,
                sessionId: session.id, 
                storeId,
                tableId: session.tableId,
                tableNumber: session.tableNumber,
                customerName: session.customerName,
                sessionMode: session.sessionMode,
                guestCount: session.guestCountFinal || session.guestCountCashierInitial,
            });
            batch.set(ticketRef, ticketPayload);

            const billablePayload = stripUndefined({
                id: ticketRef.id,
                source: "kitchenticket",
                type: "addon",
                addonId: selectedAddon.id,
                itemName: itemName,
                qty: 1,
                unitPrice: selectedAddon.price || 0,
                lineDiscountType: "fixed",
                lineDiscountValue: 0,
                isFree: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: appUser.uid,
            });
            batch.set(billableRef, billablePayload);
        }
        
        await batch.commit();
        await logActivity(appUser, "addon_ordered_pos", `Ordered ${quantity}x ${selectedAddon.name}`, { count: quantity });
        toast({ title: "Added to Order", description: `${quantity}x ${selectedAddon.name} sent to kitchen.`});
        setSelectedAddon(null);
    } catch(e: any) {
        console.error("Order Failed:", e);
        toast({ variant: 'destructive', title: "Order Failed", description: e.message || "An unexpected error occurred." });
    } finally {
        setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-[80vh] sm:h-[70vh]">
        <div className="p-4 border-b">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9"/>
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
                    {filteredAddons.map(addon => (
                        <AddonItem key={addon.id} addon={addon} onSelect={handleSelectAddon} />
                    ))}
                </div>
            )}
            {filteredAddons.length === 0 && !isLoading && (
                 <p className="text-center text-muted-foreground py-10">No add-ons available.</p>
            )}
        </ScrollArea>
        {selectedAddon && (
             <div className="p-4 border-t bg-muted/50">
                <div className="flex justify-between items-center">
                    <div>
                        <p className="font-semibold">{selectedAddon.name}</p>
                        <p className="text-sm text-muted-foreground">₱{(selectedAddon.price || 0).toFixed(2)}</p>
                    </div>
                     <div className="flex items-center gap-2">
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => Math.max(1, q - 1))}><Minus/></Button>
                        <Input type="number" value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} className="w-16 h-8 text-center" />
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(q => q + 1)}><Plus/></Button>
                     </div>
                     <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setSelectedAddon(null)}>Cancel</Button>
                        <Button size="sm" onClick={handleAddToOrder} disabled={isSubmitting || quantity < 1 || !selectedAddon.kitchenLocationId || sessionIsLocked}>
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

    