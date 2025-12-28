
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { KitchenLocation } from "./kitchen-location-edit-dialog";
import { StoreRefill, StoreFlavor } from "./store-packages-settings";
import { MenuSchedule } from "./schedules-settings";

export type StorePackage = {
    packageId: string;
    packageName: string;
    isEnabled: boolean;
    pricePerHead: number;
    kitchenLocationId: string | null;
    kitchenLocationName: string | null;
    refillsAllowed: string[];
    flavorsAllowed: string[];
    sortOrder: number;
    menuScheduleId: string | null;
};

const formSchema = z.object({
    pricePerHead: z.coerce.number().min(0),
    sortOrder: z.coerce.number().min(0),
    kitchenLocationId: z.string().nullable(),
    menuScheduleId: z.string().nullable(),
    refillsAllowed: z.array(z.string()).optional(),
    flavorsAllowed: z.array(z.string()).optional(),
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
}

export function StorePackageEditDialog({ isOpen, onClose, onSave, item, kitchenLocations, availableRefills, availableFlavors, availableSchedules }: StorePackageEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
        pricePerHead: 0,
        sortOrder: 0,
        kitchenLocationId: null,
        menuScheduleId: null,
        refillsAllowed: [],
        flavorsAllowed: [],
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
    });
  }, [item, form]);

  const handleSubmit = (data: FormValues) => {
    const kitchenLocation = kitchenLocations.find(kl => kl.id === data.kitchenLocationId);
    onSave({
        ...data,
        kitchenLocationName: kitchenLocation?.name || null
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit Store Package: {item.packageName}</DialogTitle>
          <DialogDescription>Manage price and allowed items for this package in your store.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="store-package-form" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="pricePerHead" render={({ field }) => (
                    <FormItem><FormLabel>Price per Head</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
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

            <div className="grid grid-cols-2 gap-6">
                <FormField control={form.control} name="refillsAllowed" render={() => (
                    <FormItem><FormLabel>Allowed Refills</FormLabel>
                        <ScrollArea className="h-48 rounded-md border p-4">
                            {availableRefills.map(refill => (
                                <FormField key={refill.refillId} control={form.control} name="refillsAllowed" render={({ field }) => (
                                    <FormItem className="flex items-center space-x-3 space-y-0 mb-2">
                                        <FormControl><Checkbox checked={field.value?.includes(refill.refillId)} onCheckedChange={(checked) => {return checked ? field.onChange([...(field.value || []), refill.refillId]) : field.onChange(field.value?.filter(id => id !== refill.refillId))}} /></FormControl>
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
                                        <FormControl><Checkbox checked={field.value?.includes(flavor.flavorId)} onCheckedChange={(checked) => {return checked ? field.onChange([...(field.value || []), flavor.flavorId]) : field.onChange(field.value?.filter(id => id !== flavor.flavorId))}} /></FormControl>
                                        <FormLabel className="font-normal">{flavor.flavorName}</FormLabel>
                                    </FormItem>
                                )} />
                            ))}
                        </ScrollArea>
                    </FormItem>
                )} />
            </div>
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="store-package-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
