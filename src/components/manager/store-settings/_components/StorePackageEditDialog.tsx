"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import type { StorePackage, StoreRefill, StoreFlavor, KitchenLocation, MenuSchedule } from "@/lib/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { AlertTriangle } from "lucide-react";
import { partitionVisibleRefills, stalePackageIds } from "@/lib/refill-visibility";

const formSchema = z.object({
    pricePerHead: z.coerce.number().min(0),
    sortOrder: z.coerce.number().min(0),
    kitchenLocationId: z.string().nullable(),
    menuScheduleId: z.string().nullable(),
    refillsAllowed: z.array(z.string()).optional(),
    flavorsAllowed: z.array(z.string()).optional(),
    // Bundle package: flat-priced unit covering the first `bundleMaxCap` guests.
    isBundle: z.boolean().optional(),
    bundlePrice: z.coerce.number().min(0).optional(),
    bundleMaxCap: z.coerce.number().min(1).optional(),
    bundleExtraHeadPrice: z.coerce.number().min(0).optional(),
}).refine((d) => !d.isBundle || (Number(d.bundlePrice) > 0), {
    message: "Bundle price is required.",
    path: ["bundlePrice"],
}).refine((d) => !d.isBundle || (Number(d.bundleMaxCap) >= 1), {
    message: "Max pax must be at least 1.",
    path: ["bundleMaxCap"],
});

type FormValues = z.infer<typeof formSchema>;

interface StorePackageEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Partial<StorePackage>) => void;
  item: StorePackage;
  kitchenLocations: KitchenLocation[];
  availableRefills: StoreRefill[];
  availableFlavors: StoreFlavor[];
  availableSchedules: MenuSchedule[];
  /** Every storeRefill incl. disabled — used to NAME ids the pick list cannot show. */
  allStoreRefills?: StoreRefill[];
  /** Global refill ids retired chain-wide. */
  globalInactive?: Set<string>;
}

function PackageFormFields({ form, kitchenLocations, availableSchedules, availableRefills, availableFlavors, allStoreRefills = [], globalInactive }: {
  form: any;
  kitchenLocations: KitchenLocation[];
  availableSchedules: MenuSchedule[];
  availableRefills: StoreRefill[];
  availableFlavors: StoreFlavor[];
  allStoreRefills?: StoreRefill[];
  globalInactive?: Set<string>;
}) {
  const isBundle = form.watch("isBundle");

  const selectedRefillIds: string[] = form.watch("refillsAllowed") || [];

  // Ids the pick list cannot show — disabled at this store, retired globally, or
  // deleted. They stay in refillsAllowed invisibly: not listed, not unticked.
  const staleIds = stalePackageIds(selectedRefillIds, availableRefills.map(r => r.refillId));
  const nameById = new Map(allStoreRefills.map(r => [r.refillId, r.refillName]));
  const staleEntries = staleIds.map(id => ({
    id,
    label: nameById.get(id) ?? id,
    reason: !nameById.has(id)
      ? "deleted"
      : globalInactive?.has(id)
        ? "retired in the global menu"
        : "disabled at this store",
  }));

  const preview = partitionVisibleRefills(
    availableRefills,
    globalInactive ?? new Set<string>(),
    selectedRefillIds
  );

  const clearStale = () =>
    form.setValue("refillsAllowed", selectedRefillIds.filter(id => !staleIds.includes(id)), { shouldDirty: true });
  return (
    <>
      <FormField control={form.control} name="isBundle" render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-md border p-3">
              <div>
                  <FormLabel>Bundle package</FormLabel>
                  <p className="text-xs text-muted-foreground">Bills as one flat-priced unit covering the first N guests.</p>
              </div>
              <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
          </FormItem>
      )} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isBundle ? (
            <>
              <FormField control={form.control} name="bundlePrice" render={({ field }) => (
                  <FormItem><FormLabel>Bundle Price</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="bundleMaxCap" render={({ field }) => (
                  <FormItem><FormLabel>Max Pax (covered)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><p className="text-xs text-muted-foreground">Guests included in the bundle price. Not a seating limit.</p><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="bundleExtraHeadPrice" render={({ field }) => (
                  <FormItem className="sm:col-span-2"><FormLabel>Extra Head Price (optional)</FormLabel><FormControl><Input type="number" {...field} /></FormControl><p className="text-xs text-muted-foreground">Per-head charge for guests beyond the covered count. Leave 0 to include them at no charge.</p><FormMessage /></FormItem>
              )} />
            </>
          ) : (
              <FormField control={form.control} name="pricePerHead" render={({ field }) => (
                  <FormItem><FormLabel>Price per Head</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
          )}
          <FormField control={form.control} name="sortOrder" render={({ field }) => (
              <FormItem><FormLabel>Sort Order</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="kitchenLocationId" render={({ field }) => (
              <FormItem>
                  <FormLabel>Kitchen Location</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}><FormControl><SelectTrigger><SelectValue placeholder="Select a location..." /></SelectTrigger></FormControl><SelectContent>{kitchenLocations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}</SelectContent></Select>
                  <FormMessage />
              </FormItem>
          )} />
            <FormField control={form.control} name="menuScheduleId" render={({ field }) => (
              <FormItem>
                  <FormLabel>Menu Schedule</FormLabel>
                  <Select onValueChange={(val) => field.onChange(val === 'none' ? null : val)} value={field.value || 'none'}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select a schedule..." /></SelectTrigger></FormControl>
                      <SelectContent>
                          <SelectItem value="none">None (Always Available)</SelectItem>
                          {availableSchedules.map(sc => <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>)}
                      </SelectContent>
                  </Select>
                  <FormMessage />
              </FormItem>
          )} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FormField control={form.control} name="refillsAllowed" render={() => (
              <FormItem><FormLabel>Allowed Refills</FormLabel>
                  <ScrollArea className="h-48 rounded-md border p-4">
                      {availableRefills.map(refill => (
                          <FormField key={refill.refillId} control={form.control} name="refillsAllowed" render={({ field }) => (
                              <FormItem className="flex items-center space-x-3 space-y-0 mb-2">
                                  <FormControl><Checkbox checked={field.value?.includes(refill.refillId)} onCheckedChange={(checked) => {return checked ? field.onChange([...(field.value || []), refill.refillId]) : field.onChange(field.value?.filter((id: string) => id !== refill.refillId))}} /></FormControl>
                                  <FormLabel className="font-normal">{refill.refillName}</FormLabel>
                              </FormItem>
                          )} />
                      ))}
                  </ScrollArea>
              </FormItem>
          )} />
            <FormField control={form.control} name="flavorsAllowed" render={() => (
              <FormItem><FormLabel>Allowed Flavors</FormLabel>
                  <ScrollArea className="h-48 rounded-md border p-4">
                      {availableFlavors.map(flavor => (
                          <FormField key={flavor.flavorId} control={form.control} name="flavorsAllowed" render={({ field }) => (
                              <FormItem className="flex items-center space-x-3 space-y-0 mb-2">
                                  <FormControl><Checkbox checked={field.value?.includes(flavor.flavorId)} onCheckedChange={(checked) => {return checked ? field.onChange([...(field.value || []), flavor.flavorId]) : field.onChange(field.value?.filter((id: string) => id !== flavor.flavorId))}} /></FormControl>
                                  <FormLabel className="font-normal">{flavor.flavorName}</FormLabel>
                              </FormItem>
                          )} />
                      ))}
                  </ScrollArea>
              </FormItem>
          )} />
      </div>

      {/* What the customer will actually get. A package can silently grant a meat
          only through a refill that is disabled or retired, in which case the meat
          never appears — the failure has no error anywhere else. */}
      <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">Customers will see</p>
          {preview.mains.length === 0 ? (
              <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> No refills at all — this package would offer nothing.
              </p>
          ) : (
              <p className="text-sm">{preview.mains.map(r => r.refillName).join(", ")}</p>
          )}
          {preview.others.length > 0 && (
              <p className="text-xs text-muted-foreground">Other Refills: {preview.others.map(r => r.refillName).join(", ")}</p>
          )}

          {staleEntries.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-1.5 dark:bg-amber-900/20 dark:border-amber-800">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> This package still grants refills it can no longer offer
                  </p>
                  <ul className="text-xs text-muted-foreground pl-1 space-y-0.5">
                      {staleEntries.map(e => (
                          <li key={e.id}>{e.label} — {e.reason}</li>
                      ))}
                  </ul>
                  <Button type="button" variant="outline" size="sm" onClick={clearStale}>
                      Clear stale entries
                  </Button>
              </div>
          )}
      </div>
    </>
  )
}

export function StorePackageEditDialog({ isOpen, onClose, onSave, item, kitchenLocations, availableRefills, availableFlavors, availableSchedules, allStoreRefills, globalInactive }: StorePackageEditDialogProps) {
  const isMobile = useIsMobile();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
        pricePerHead: 0,
        sortOrder: 0,
        kitchenLocationId: null,
        menuScheduleId: null,
        refillsAllowed: [],
        flavorsAllowed: [],
        isBundle: false,
        bundlePrice: 0,
        bundleMaxCap: 1,
        bundleExtraHeadPrice: 0,
    },
  });

  useEffect(() => {
    form.reset({
        pricePerHead: item.pricePerHead,
        sortOrder: item.sortOrder,
        kitchenLocationId: item.kitchenLocationId,
        menuScheduleId: item.menuScheduleId,
        refillsAllowed: item.refillsAllowed || [],
        flavorsAllowed: item.flavorsAllowed || [],
        isBundle: item.isBundle ?? false,
        bundlePrice: item.bundlePrice ?? 0,
        bundleMaxCap: item.bundleMaxCap ?? 1,
        bundleExtraHeadPrice: item.bundleExtraHeadPrice ?? 0,
    });
  }, [item, form]);

  const handleSubmit = (data: FormValues) => {
    const kitchenLocation = kitchenLocations.find(kl => kl.id === data.kitchenLocationId);
    onSave({
        ...data,
        kitchenLocationName: kitchenLocation?.name || null
    });
  };

  const formContent = <PackageFormFields form={form} kitchenLocations={kitchenLocations} availableSchedules={availableSchedules} availableRefills={availableRefills} availableFlavors={availableFlavors} allStoreRefills={allStoreRefills} globalInactive={globalInactive} />;
  
  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={onClose}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>Edit Store Package</DrawerTitle>
            <DrawerDescription>{item.packageName}</DrawerDescription>
          </DrawerHeader>
          <div className="p-4 overflow-y-auto max-h-[65vh]">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} id="store-package-form-mobile" className="space-y-4">
                {formContent}
              </form>
            </Form>
          </div>
          <DrawerFooter className="pt-2">
            <Button type="submit" form="store-package-form-mobile">Save Changes</Button>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* Flex column + capped height so the header and footer stay pinned and only
          the field area scrolls — the refill/flavor checklists make this form
          taller than the viewport on short screens. */}
      <DialogContent className="sm:max-w-4xl flex flex-col max-h-[90dvh]">
        <DialogHeader>
          <DialogTitle>Edit Store Package: {item.packageName}</DialogTitle>
          <DialogDescription>Manage price and allowed items for this package in your store.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="store-package-form" className="space-y-4 py-4 flex-1 min-h-0 overflow-y-auto px-1">
            {formContent}
          </form>
        </Form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="store-package-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
