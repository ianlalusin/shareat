
"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Minus, Plus, Loader2, ScanLine } from "lucide-react";
import Image from "next/image";
import { useIsMobile } from "@/hooks/use-mobile";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, getDoc, orderBy, limit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { ScrollArea } from "../ui/scroll-area";
import { stripUndefined } from "@/lib/firebase/utils";
import type { Product, StoreAddon, PendingSession } from "@/lib/types";
import { SingleScanBarcodeScanner } from "../shared/SingleScanBarcodeScanner";
import { computeSessionLabel } from "@/lib/utils/session";
import { QuantityInput } from "./quantity-input";
import { allowsDecimalQty } from "@/lib/uom";

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
  const [isScannerOpen, setIsScannerOpen] = useState(false);

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
            return { 
              ...addon, 
              uom: productData?.uom || addon.uom,
              imageUrl: productData?.imageUrl || addon.imageUrl,
              barcode: productData?.barcode || undefined,
            };
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
    const allowDecimal = allowsDecimalQty(addon.uom);
    setSelectedAddon(addon);
    setQuantity(allowDecimal ? 0.1 : 1);
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
        const loopQty = Math.floor(quantity);
        const toastQtyString = `${quantity}x`;

        for (let i = 0; i < loopQty; i++) {
            const ticketRef = doc(collection(db, "stores", storeId, "sessions", session.id, "kitchentickets"));
            const billableRef = doc(db, "stores", storeId, "sessions", session.id, "billables", ticketRef.id);
            const itemName = selectedAddon.name;

            const ticketPayload = stripUndefined({
                id: ticketRef.id,
                type: "addon",
                itemName: itemName,
                qty: 1, // Always 1 per document
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
            });
            batch.set(ticketRef, ticketPayload);

            const billablePayload = stripUndefined({
                id: ticketRef.id,
                source: "kitchenticket",
                type: "addon",
                addonId: selectedAddon.id,
                itemName: itemName,
                qty: 1, // Always 1 per document
                uom: selectedAddon.uom,
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
        toast({ title: "Added to Order", description: `${toastQtyString} ${selectedAddon.name} sent to kitchen.`});
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
        toast({ title: "Item Found", description: `Selected: ${foundAddon.name}`});
    } else {
        toast({ variant: "destructive", title: "Not Found", description: "No add-on with this barcode was found in the store's active items."});
    }
  };

  const allowDecimal = selectedAddon ? allowsDecimalQty(selectedAddon.uom) : false;
  
  // Force integer quantity for add-ons now
  const qtyStep = 1;
  const qtyMin = 1;
  
  const handleQtyChange = (val: number) => {
      setQuantity(Math.floor(val));
  }

  const decrementQty = () => {
      setQuantity(q => Math.max(qtyMin, q - qtyStep));
  }

  const incrementQty = () => {
      setQuantity(q => q + qtyStep);
  }

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
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={decrementQty}><Minus/></Button>
                        <QuantityInput 
                            value={quantity} 
                            onChange={handleQtyChange}
                            className="w-20 h-8 text-center" 
                            allowDecimal={false} // Force integer for addons
                        />
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={incrementQty}><Plus/></Button>
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
