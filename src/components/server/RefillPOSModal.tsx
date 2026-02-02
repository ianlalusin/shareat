

"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, X } from "lucide-react";
import { collection, onSnapshot, query, where, doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { ScrollArea } from "../ui/scroll-area";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StorePackage, PendingSession, Refill, StoreRefill, StoreFlavor } from "@/lib/types";
import { Separator } from "../ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { createKitchenTickets, getActorStamp } from "../cashier/firestore";

interface RefillPOSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
}

type CartItem = {
    refill: StoreRefill;
    flavorIds: string[];
    notes: string;
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
  const [storeRefills, setStoreRefills] = useState<StoreRefill[]>([]);
  const [globalRefills, setGlobalRefills] = useState<Refill[]>([]);
  const [storeFlavors, setStoreFlavors] = useState<StoreFlavor[]>([]);
  const [currentPackage, setCurrentPackage] = useState<StorePackage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [activeRefillId, setActiveRefillId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!storeId) {
        setIsLoading(false);
        return;
    };
    
    const unsubs: (() => void)[] = [];

    const storeRefillsQuery = query(
        collection(db, "stores", storeId, "storeRefills"),
        where("isEnabled", "==", true),
        orderBy("sortOrder", "asc")
    );
    unsubs.push(onSnapshot(storeRefillsQuery, (snapshot) => {
        setStoreRefills(
          snapshot.docs.map((d) => {
            const data = d.data() as Omit<StoreRefill, "id">;
            return { ...data, id: d.id, refillId: d.id };
          })
        );
    }));
    
    const globalRefillsQuery = query(collection(db, "refills"), where("isActive", "==", true));
    unsubs.push(onSnapshot(globalRefillsQuery, (snapshot) => setGlobalRefills(snapshot.docs.map(d => ({id: d.id, ...d.data()} as Refill)))));

    const flavorsQuery = query(
        collection(db, "stores", storeId, "storeFlavors"),
        where("isEnabled", "==", true),
    );
    unsubs.push(onSnapshot(flavorsQuery, (snapshot) => {
        setStoreFlavors(
          snapshot.docs.map((d) => {
            const data = d.data() as Omit<StoreFlavor, "id">;
            return { ...data, id: d.id, flavorId: d.id };
          })
        );
    }));

    if (session.packageOfferingId) {
        const packageRef = doc(db, "stores", storeId, "storePackages", session.packageOfferingId);
        unsubs.push(onSnapshot(packageRef, (docSnap) => {
            if (docSnap.exists()) {
                setCurrentPackage(docSnap.data() as StorePackage);
            }
        }));
    }
    
    Promise.all([getDocs(storeRefillsQuery), getDocs(flavorsQuery)]).finally(() => setIsLoading(false));
    
    return () => unsubs.forEach(unsub => unsub());
  }, [storeId, session.packageOfferingId]);
  
  const filteredRefills = useMemo(() => {
    let availableRefills = storeRefills;

    if (currentPackage && currentPackage.refillsAllowed && currentPackage.refillsAllowed.length > 0) {
        const allowedIds = new Set(currentPackage.refillsAllowed);
        availableRefills = availableRefills.filter(r => allowedIds.has(r.refillId));
    }
    
    return availableRefills;
  }, [storeRefills, currentPackage]);

  const activeCartItem = activeRefillId ? cart.get(activeRefillId) : null;
  const activeGlobalRefill = activeCartItem ? globalRefills.find(r => r.id === activeCartItem.refill.refillId) : null;
  
  const sortedAllowedFlavors = useMemo(() => {
    if (!activeCartItem) return [];
    
    const globalRefillInfo = globalRefills.find(r => r.id === activeCartItem.refill.refillId);
    if (!globalRefillInfo?.requiresFlavor) return [];

    const globallyAllowedFlavorIds = new Set(globalRefillInfo.allowedFlavorIds || []);
    const storeEnabledFlavorIds = new Set(storeFlavors.map(f => f.flavorId));
    
    const finalAllowedIds = globallyAllowedFlavorIds.size === 0
      ? storeEnabledFlavorIds
      : new Set([...globallyAllowedFlavorIds].filter(id => storeEnabledFlavorIds.has(id)));

    const allowedStoreFlavors = storeFlavors.filter(f => finalAllowedIds.has(f.flavorId));
    
    const initialFlavorIds = new Set(session.initialFlavorIds || []);
    return allowedStoreFlavors.sort((a, b) => {
        const aIsInitial = initialFlavorIds.has(a.flavorId);
        const bIsInitial = initialFlavorIds.has(b.flavorId);
        if (aIsInitial && !bIsInitial) return -1;
        if (!aIsInitial && bIsInitial) return 1;
        return a.flavorName.localeCompare(b.flavorName);
    });
}, [activeCartItem, storeFlavors, globalRefills, session.initialFlavorIds]);


  const handleSelectRefill = (refill: StoreRefill) => {
    setCart(prev => {
        const newCart = new Map(prev);
        if (!newCart.has(refill.refillId)) {
            newCart.set(refill.refillId, {
                refill: refill,
                flavorIds: [],
                notes: ""
            });
        }
        return newCart;
    });
    setActiveRefillId(refill.refillId);
  };
  
  const handleAddToOrder = async () => {
    if (sessionIsLocked) {
      toast({ variant: "destructive", title: "Session Closed", description: "Session is closed. KDS updates are disabled." });
      return;
    }
    if (!appUser || cart.size === 0) {
      toast({ variant: "destructive", title: "Cannot Add Item", description: "Your order list is empty." });
      return;
    }
    
    // Validate all items in cart
    for (const item of cart.values()) {
        if (!item.refill.kitchenLocationId) {
            toast({ variant: 'destructive', title: 'Kitchen Not Assigned', description: `"${item.refill.refillName}" has no kitchen location assigned.` });
            return;
        }
        const globalRefillInfo = globalRefills.find(r => r.id === item.refill.refillId);
        if (globalRefillInfo?.requiresFlavor && sortedAllowedFlavors.length > 0 && item.flavorIds.length === 0) {
            toast({ variant: 'destructive', title: 'Flavor Required', description: `"${item.refill.refillName}" requires at least one flavor.` });
            setActiveRefillId(item.refill.refillId); // Switch to the item that needs attention
            return;
        }
    }

    setIsSubmitting(true);
    
    try {
        const actor = getActorStamp(appUser);
        await runTransaction(db, async (tx) => {
            for (const item of cart.values()) {
                const stationId = item.refill.kitchenLocationId;
                if (!stationId) {
                    throw new Error(`Refill item "${item.refill.refillName}" is missing an assigned kitchen location.`);
                }
    
                const selectedFlavorNames = item.flavorIds.map(id => storeFlavors.find(f => f.flavorId === id)?.flavorName || id);
                let finalNotes = item.notes.trim();
                if (selectedFlavorNames.length > 0) {
                    const flavorNote = `Flavors: ${selectedFlavorNames.join(", ")}`;
                    finalNotes = finalNotes ? `${flavorNote}\n${finalNotes}` : flavorNote;
                }
    
                await createKitchenTickets(
                    db,
                    storeId,
                    session.id,
                    session,
                    'refill',
                    {
                        itemId: item.refill.refillId,
                        itemName: item.refill.refillName,
                        kitchenLocationId: stationId,
                        kitchenLocationName: item.refill.kitchenLocationName,
                        billLineId: null,
                    },
                    1, // Qty for refill ticket is always 1
                    actor,
                    { tx },
                    finalNotes
                );
            }
        });
        
        toast({ title: `Sent ${cart.size} refill(s) to the kitchen.` });
        handleReset();

    } catch(e: any) {
        toast({ variant: 'destructive', title: "Order Failed", description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleRepeatFirstOrder = async () => {
    if (sessionIsLocked) {
      toast({ variant: "destructive", title: "Session Closed", description: "Session is closed. KDS updates are disabled." });
      return;
    }
    if (!appUser || !currentPackage) {
        toast({ variant: "destructive", title: "Cannot Repeat Order", description: "Package information not found." });
        return;
    }
    setIsSubmitting(true);

    try {
        const allowedRefillIds = new Set(currentPackage.refillsAllowed || []);
        const refillsToOrder = storeRefills.filter(sr => sr.isEnabled && allowedRefillIds.has(sr.refillId) && sr.kitchenLocationId);
        
        if (refillsToOrder.length === 0) {
            toast({ variant: "destructive", title: "No Refills", description: "No valid refills are enabled for this package." });
            setIsSubmitting(false);
            return;
        }

        const first = refillsToOrder[0];
        if (!first.kitchenLocationId) {
            toast({ variant: "destructive", title: "Kitchen Not Assigned", description: `The first available refill "${first.refillName}" has no kitchen location assigned.` });
            setIsSubmitting(false);
            return;
        }

        const flavorIds = session.initialFlavorIds || [];
        const flavorNames = flavorIds
          .map(id => storeFlavors.find(f => f.flavorId === id)?.flavorName || id)
          .filter(Boolean);
        
        let notes = "";
        if (flavorNames.length) notes = `Flavors: ${flavorNames.join(", ")}`;
        const extraNotes = (activeCartItem?.notes || "").trim();
        if (extraNotes) notes = notes ? `${notes}\n${extraNotes}` : extraNotes;
        
        const guestCount = session.guestCountFinal || session.guestCountCashierInitial || 1;
        const packageName = (currentPackage as any)?.packageName || (currentPackage as any)?.name || session.packageSnapshot?.name || "Package";
        const itemName = `REFILL - ${packageName}`;
        
        const actor = getActorStamp(appUser);
        await runTransaction(db, async (tx) => {
            await createKitchenTickets(
                db,
                storeId,
                session.id,
                session,
                'refill',
                {
                    itemId: "REFILL_PACKAGE_FIRST_ORDER",
                    itemName: itemName,
                    kitchenLocationId: first.kitchenLocationId!,
                    kitchenLocationName: first.kitchenLocationName,
                    billLineId: null,
                },
                1,
                actor,
                { tx },
                notes
            );
        });
        
        toast({
            title: "Sent refill ticket to kitchen.",
            description: itemName
        });

        onClose();

    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Order Failed', description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };


  const handleReset = () => {
    setCart(new Map());
    setActiveRefillId(null);
    onClose();
  }
  
  const handleFlavorToggle = (flavorId: string) => {
    if (!activeRefillId) return;

    setCart(prev => {
        const newCart = new Map(prev);
        const item = newCart.get(activeRefillId);
        if (item) {
            const isSelected = item.flavorIds.includes(flavorId);
            let newFlavorIds = item.flavorIds;
            if (isSelected) {
                newFlavorIds = item.flavorIds.filter(id => id !== flavorId);
            } else {
                 if (item.flavorIds.length >= 3) {
                    toast({ variant: 'destructive', title: 'Flavor Limit Reached', description: 'You can select a maximum of 3 flavors.'});
                    return prev; // Return previous state without changes
                }
                newFlavorIds = [...item.flavorIds, flavorId];
            }
            newCart.set(activeRefillId, { ...item, flavorIds: newFlavorIds });
        }
        return newCart;
    });
  }
  
  const handleNotesChange = (notes: string) => {
    if (!activeRefillId) return;
    setCart(prev => {
      const newCart = new Map(prev);
      const item = newCart.get(activeRefillId);
      if (item) {
        newCart.set(activeRefillId, { ...item, notes });
      }
      return newCart;
    });
  };

  const handleRemoveFromCart = (refillId: string) => {
      setCart(prev => {
          const newCart = new Map(prev);
          newCart.delete(refillId);
          // If the removed item was the active one, reset active selection
          if (activeRefillId === refillId) {
              setActiveRefillId(newCart.keys().next().value || null);
          }
          return newCart;
      });
  }

  const defaultFlavorNames = useMemo(() => {
    if (!session.initialFlavorIds || !storeFlavors) return "";
    return session.initialFlavorIds
        .map(id => storeFlavors.find(f => f.flavorId === id)?.flavorName)
        .filter(Boolean)
        .join(", ");
  }, [session.initialFlavorIds, storeFlavors]);
  
  const initialFlavorIdSet = useMemo(() => new Set(session.initialFlavorIds || []), [session.initialFlavorIds]);

  const needsFlavors = !!activeGlobalRefill?.requiresFlavor && sortedAllowedFlavors.length > 0;

  return (
    <div className="h-[70vh] flex flex-col">
      {session.sessionMode === 'package_dinein' && (
        <div className="p-4 border-b">
            <div className="flex items-start sm:items-center gap-4 flex-col sm:flex-row">
                <Button 
                    variant="destructive"
                    onClick={handleRepeatFirstOrder}
                    disabled={isSubmitting || sessionIsLocked}
                    className="flex-shrink-0"
                >
                    <RefreshCw className="mr-2 h-4 w-4" /> Repeat First Order
                </Button>
                <div className="text-xs text-muted-foreground">
                    <p>Sends all refills allowed by the package with the default flavors.</p>
                    {currentPackage?.packageName && (
                    <p>
                        <span className="font-semibold">{currentPackage.packageName}:</span> <span className="text-destructive font-medium">{defaultFlavorNames}</span>
                    </p>
                    )}
                </div>
            </div>
            <Separator className="mt-2 mb-0" />
        </div>
      )}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 overflow-y-auto">
        {/* Left Panel: Refills */}
        <div className="md:col-span-1 border-r pr-4 flex flex-col">
          <h3 className="font-semibold mb-2">1. Select Refills</h3>
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {isLoading ? (
                <Loader2 className="mx-auto my-16 animate-spin"/>
              ) : (
                filteredRefills.map(refill => (
                  <button
                    key={refill.refillId}
                    onClick={() => handleSelectRefill(refill)}
                    className={cn(
                        "w-full text-left p-2 border rounded-md hover:bg-muted/50 transition-colors focus:outline-none",
                        cart.has(refill.refillId) && "bg-muted font-semibold",
                        activeRefillId === refill.refillId && "bg-destructive/10 text-destructive border-destructive font-bold"
                    )}
                  >
                    {refill.refillName}
                  </button>
                ))
              )}
               {filteredRefills.length === 0 && !isLoading && (
                 <p className="text-center text-sm text-muted-foreground py-10">No refills available for this package.</p>
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel: Flavors & Notes for Active Item */}
        <div className="md:col-span-2 flex flex-col gap-4">
          <h3 className="font-semibold">2. Customize Selection</h3>
          {activeCartItem ? (
            <div className="flex-1 flex flex-col gap-4">
              <div className={cn("border rounded-lg", !needsFlavors && "bg-muted/50")}>
                <div className="p-4 space-y-2">
                  <h3 className="font-semibold">Flavors {needsFlavors && "(up to 3)"}</h3>
                  {needsFlavors ? (
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                        {sortedAllowedFlavors.map(flavor => (
                            <div key={flavor.flavorId} className="flex items-center gap-2">
                                <Checkbox
                                    id={`flavor-${flavor.flavorId}`}
                                    checked={activeCartItem.flavorIds.includes(flavor.flavorId)}
                                    onCheckedChange={() => handleFlavorToggle(flavor.flavorId)}
                                />
                                <Label 
                                  htmlFor={`flavor-${flavor.flavorId}`} 
                                  className={cn(
                                    "font-normal",
                                    initialFlavorIdSet.has(flavor.flavorId) && "text-destructive font-medium"
                                  )}
                                >
                                    {flavor.flavorName}
                                </Label>
                            </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">This item does not require flavors.</p>
                  )}
                </div>
              </div>
              <div className="flex-1 flex flex-col gap-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea 
                  id="notes" 
                  value={activeCartItem.notes} 
                  onChange={e => handleNotesChange(e.target.value)} 
                  placeholder="e.g., extra hot, no onions..." 
                  className="flex-1"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center text-muted-foreground bg-muted/50 rounded-lg">
                <p>Select a refill item from the left to customize it.</p>
            </div>
          )}
        </div>
      </div>
      
      <DialogFooter className="p-4 border-t">
        <Button variant="ghost" onClick={handleReset}>Cancel</Button>
        <Button 
          onClick={handleAddToOrder} 
          disabled={isSubmitting || sessionIsLocked || cart.size === 0}
        >
           {isSubmitting ? <Loader2 className="animate-spin" /> : `Send ${cart.size} Item(s) to Kitchen`}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function RefillPOSModal(props: RefillPOSModalProps) {
  const isMobile = useIsMobile();
  
  const handleOpenChange = (open: boolean) => {
    if (!open) props.onOpenChange(false);
  };

  if (isMobile) {
    return (
      <Drawer open={props.open} onOpenChange={handleOpenChange}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Order Refill</DrawerTitle>
            <DrawerDescription>Select refill items and any required flavors.</DrawerDescription>
          </DrawerHeader>
          <POSContent {...props} onClose={() => props.onOpenChange(false)} />
        </DrawerContent>
      </Drawer>
    );
  }
  
  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl p-0 gap-0">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Order Refill</DialogTitle>
            <DialogDescription>Select refill items and any required flavors.</DialogDescription>
          </DialogHeader>
          <POSContent {...props} onClose={() => props.onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

    
