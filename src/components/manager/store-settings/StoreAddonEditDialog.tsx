
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
import { StoreAddon } from "./addons-settings";
import { KitchenLocation } from "./kitchen-locations-settings";

const formSchema = z.object({
    price: z.coerce.number().min(0, "Price must be a positive number."),
    sortOrder: z.coerce.number().min(0),
    kitchenLocationId: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

interface StoreAddonEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (addonId: string, data: Partial<StoreAddon>) => void;
  addon: StoreAddon;
  kitchenLocations: KitchenLocation[];
}

export function StoreAddonEditDialog({ isOpen, onClose, onSave, addon, kitchenLocations }: StoreAddonEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
        price: 0,
        sortOrder: 1000,
        kitchenLocationId: null,
    },
  });

  useEffect(() => {
    if (addon) {
        form.reset({
            price: addon.price,
            sortOrder: addon.sortOrder,
            kitchenLocationId: addon.kitchenLocationId || null,
        });
    }
  }, [addon, form]);

  const handleSubmit = (data: FormValues) => {
    const kitchenLocationName = kitchenLocations.find(kl => kl.id === data.kitchenLocationId)?.name || null;
    onSave(addon.id, { ...data, kitchenLocationName });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Add-on: {addon.name}</DialogTitle>
          <DialogDescription>Manage price and kitchen assignment for this item in your store.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="store-addon-form" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="price" render={({ field }) => (
                    <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="sortOrder" render={({ field }) => (
                    <FormItem><FormLabel>Sort Order</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
            </div>
             <FormField control={form.control} name="kitchenLocationId" render={({ field }) => (
                <FormItem>
                    <FormLabel>Kitchen Location</FormLabel>
                    <Select onValueChange={(val) => field.onChange(val === 'none' ? null : val)} value={field.value || 'none'}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select a location..." /></SelectTrigger></FormControl>
                        <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {kitchenLocations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="store-addon-form">Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
