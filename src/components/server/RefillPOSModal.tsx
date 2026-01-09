
"use client";

import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, orderBy, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { ScrollArea } from "../ui/scroll-area";
import { stripUndefined } from "@/lib/firebase/utils";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { cn } from "@/lib/utils";
import type { StorePackage, PendingSession, Refill, StoreRefill, StoreFlavor } from "@/lib/types";
import { computeSessionLabel } from "@/lib/utils/session";
import { Separator } from "../ui/separator";

interface RefillPOSModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  session: PendingSession;
  sessionIsLocked?: boolean;
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
  
  const [selectedRefill, setSelectedRefill] = useState<StoreRefill | null>(null);
  const [selectedFlavorIds, setSelectedFlavorIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
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
  
  const currentRefillAllowedFlavors = useMemo(() => {
    if (!selectedRefill) return [];
    
    const globalRefillInfo = globalRefills.find(r => r.id === selectedRefill.refillId);
    
    if (!globalRefillInfo?.requiresFlavor) return [];

    const globallyAllowedFlavorIds = new Set(globalRefillInfo.allowedFlavorIds || []);
    const storeEnabledFlavorIds = new Set(storeFlavors.map(f => f.flavorId));

    const finalAllowedIds = new Set(
        [...globallyAllowedFlavorIds].filter(id => storeEnabledFlavorIds.has(id))
    );
    
    if (globallyAllowedFlavorIds.size === 0) {
      return storeFlavors;
    }

    return storeFlavors.filter(f => finalAllowedIds.has(f.flavorId));
  }, [selectedRefill, storeFlavors, globalRefills]);

  const handleSelectRefill = (refill: StoreRefill) => {
    setSelectedRefill(refill);
    setSelectedFlavorIds([]);
    setNotes("");
  };
  
  const handleAddToOrder = async () => {
    if (!appUser || !selectedRefill) {
      toast({ variant: "destructive", title: "Cannot Add Item" });
      return;
    }
    if (sessionIsLocked) {
      toast({ variant: "destructive", title: "Session Locked" });
      return;
    }
    if (!selectedRefill.kitchenLocationId) {
      toast({ variant: 'destructive', title: 'Kitchen Not Assigned' });
      return;
    }

    setIsSubmitting(true);
    
    const batch = writeBatch(db);
    try {
        const ticketRef = doc(collection(db, "stores", storeId, "sessions", session.id, "kitchentickets"));
        const itemName = `${selectedRefill.refillName}`;
        
        const selectedFlavorNames = selectedFlavorIds.map(id => storeFlavors.find(f => f.flavorId === id)?.flavorName || id);
        let finalNotes = notes.trim();
        if (selectedFlavorNames.length > 0) {
            const flavorNote = `Flavors: ${selectedFlavorNames.join(", ")}`;
            finalNotes = finalNotes ? `${flavorNote}\n${finalNotes}` : flavorNote;
        }

        const ticketPayload = stripUndefined({
            id: ticketRef.id,
            type: "refill",
            itemName,
            qty: 1,
            kitchenLocationId: selectedRefill.kitchenLocationId,
            kitchenLocationName: selectedRefill.kitchenLocationName,
            notes: finalNotes || null,
            status: "preparing",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
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

        await batch.commit();
        toast({ title: "Refill Ordered", description: `${itemName} sent to kitchen.`});
        handleReset();
    } catch(e: any) {
        toast({ variant: 'destructive', title: "Order Failed", description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };

  const handleRepeatFirstOrder = async () => {
    if (!appUser || !currentPackage || !currentPackage.refillsAllowed) {
        toast({ variant: "destructive", title: "Cannot Repeat Order", description: "Package information not found." });
        return;
    }
    setIsSubmitting(true);

    try {
        const allowedRefillIds = new Set(currentPackage.refillsAllowed);
        const refillsToOrder = storeRefills.filter(sr => sr.isEnabled && allowedRefillIds.has(sr.refillId) && sr.kitchenLocationId);
        
        if (refillsToOrder.length === 0) {
            toast({ variant: "destructive", title: "No Refills", description: "No valid refills are enabled for this package." });
            return;
        }

        const defaultFlavorIds = session.initialFlavorIds || [];
        const defaultFlavorNames = defaultFlavorIds.map(id => storeFlavors.find(f => f.flavorId === id)?.flavorName || id).join(', ');

        const batch = writeBatch(db);
        const ticketsRef = collection(db, "stores", storeId, "sessions", session.id, "kitchentickets");

        for (const refill of refillsToOrder) {
            const ticketRef = doc(ticketsRef);
            const notes = `Repeat First Order\nFlavors: ${defaultFlavorNames}`;

            const payload = {
                id: ticketRef.id,
                type: "refill",
                itemName: refill.refillName,
                qty: 1,
                notes: notes,
                status: "preparing",
                kitchenLocationId: refill.kitchenLocationId,
                kitchenLocationName: refill.kitchenLocationName,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: appUser.uid,
                sessionId: session.id,
                storeId,
                tableNumber: session.tableNumber,
                customerName: session.customer?.name || session.customerName,
                sessionMode: session.sessionMode,
                sessionLabel: computeSessionLabel(session),
                guestCount: session.guestCountFinal || session.guestCountCashierInitial,
            };
            batch.set(ticketRef, stripUndefined(payload));
        }

        await batch.commit();
        toast({ title: "Refill Set Ordered", description: `Sent ${refillsToOrder.length} tickets to the kitchen.` });
        onClose();

    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Order Failed', description: e.message });
    } finally {
        setIsSubmitting(false);
    }
  };


  const handleReset = () => {
    setSelectedRefill(null);
    setSelectedFlavorIds([]);
    setNotes("");
    onClose();
  }
  
  const handleFlavorToggle = (flavorId: string) => {
      const isSelected = selectedFlavorIds.includes(flavorId);
      if (!isSelected && selectedFlavorIds.length >= 3) {
          toast({ variant: 'destructive', title: 'Flavor Limit Reached', description: 'You can select a maximum of 3 flavors.'});
          return;
      }

      setSelectedFlavorIds(prev => 
        isSelected ? prev.filter(id => id !== flavorId) : [...prev, flavorId]
      );
  }

  const globalRefillInfo = globalRefills.find(r => r.id === selectedRefill?.refillId);
  const needsFlavors = !!globalRefillInfo?.requiresFlavor && currentRefillAllowedFlavors.length > 0;
  
  return (
    <div className="h-[70vh] flex flex-col">
      {session.sessionMode === 'package_dinein' && (
        <div className="p-4 border-b">
          <Button 
            className="w-full" 
            variant="secondary"
            onClick={handleRepeatFirstOrder}
            disabled={isSubmitting || sessionIsLocked}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Repeat First Order (Refill Set)
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Sends all package refills with the session's initial flavors.
          </p>
          <Separator className="my-4" />
        </div>
      )}
      <div className="flex-1 grid grid-cols-3 gap-4 p-4 overflow-hidden">
        {/* Left Panel: Refills */}
        <div className="col-span-1 border-r pr-4">
          <h3 className="font-semibold mb-2">Order Single Refill</h3>
          <ScrollArea className="h-full">
            <div className="space-y-1">
              {isLoading ? (
                <Loader2 className="mx-auto my-16 animate-spin"/>
              ) : (
                filteredRefills.map(refill => (
                  <button
                    key={refill.refillId}
                    onClick={() => handleSelectRefill(refill)}
                    className={cn(
                      "w-full text-left p-2 border rounded-md hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
                      selectedRefill?.refillId === refill.refillId && "bg-muted ring-2 ring-ring"
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

        {/* Right Panel: Flavors & Notes */}
        <div className="col-span-2 flex flex-col gap-4">
          <div className={cn("border rounded-lg", !selectedRefill && "bg-muted/50 flex items-center justify-center")}>
            <div className={cn("p-4 space-y-2", !needsFlavors && !selectedRefill && "hidden")}>
              <h3 className="font-semibold">Flavors {needsFlavors && "(up to 3)"}</h3>
              {needsFlavors ? (
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {currentRefillAllowedFlavors.map(flavor => (
                        <div key={flavor.flavorId} className="flex items-center gap-2">
                            <Checkbox
                                id={`flavor-${flavor.flavorId}`}
                                checked={selectedFlavorIds.includes(flavor.flavorId)}
                                onCheckedChange={() => handleFlavorToggle(flavor.flavorId)}
                            />
                            <Label htmlFor={`flavor-${flavor.flavorId}`} className="font-normal">{flavor.flavorName}</Label>
                        </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{selectedRefill ? "This item does not require flavors." : "Select a refill to see flavor options."}</p>
              )}
            </div>
             {!selectedRefill && <p className="text-sm text-muted-foreground">Select a refill item</p>}
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea 
              id="notes" 
              value={notes} 
              onChange={e => setNotes(e.target.value)} 
              placeholder="e.g., extra hot, no onions..." 
              className="flex-1"
              disabled={!selectedRefill}
            />
          </div>
        </div>
      </div>
      <DialogFooter className="p-4 border-t">
        <Button variant="ghost" onClick={handleReset}>Cancel</Button>
        <Button 
          onClick={handleAddToOrder} 
          disabled={isSubmitting || sessionIsLocked || !selectedRefill || (needsFlavors && selectedFlavorIds.length === 0)}
        >
           {isSubmitting ? <Loader2 className="animate-spin" /> : "Send to Kitchen"}
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
          <DrawerHeader>
            <DrawerTitle>Order Refill</DrawerTitle>
            <DrawerDescription>Select a refill item to order.</DrawerDescription>
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
            <DialogTitle>Order Refill</DialogTitle>
            <DialogDescription>Select a refill item and any required flavors.</DialogDescription>
          </DialogHeader>
          <POSContent {...props} onClose={() => props.onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
