
"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Refill } from "@/app/admin/menu/refills/page";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import type { StoreFlavor } from "@/components/manager/store-settings/store-packages-settings";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  requiresFlavor: z.boolean().default(false),
  allowedFlavorIds: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

interface RefillEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues) => void;
  item: Refill | null;
  isSubmitting: boolean;
  flavors: StoreFlavor[];
}

export function RefillEditDialog({ isOpen, onClose, onSave, item, isSubmitting, flavors }: RefillEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", requiresFlavor: false, allowedFlavorIds: [], isActive: true },
  });

  const requiresFlavor = useWatch({ control: form.control, name: "requiresFlavor" });

  useEffect(() => {
    if (item) {
      form.reset(item);
    } else {
      form.reset({ name: "", requiresFlavor: false, allowedFlavorIds: [], isActive: true });
    }
  }, [item, form, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{item ? "Edit Refill" : "Create New Refill"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} id="refill-form" className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
             <FormField control={form.control} name="requiresFlavor" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <FormLabel>Requires Flavor</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />

            {requiresFlavor && (
              <FormField control={form.control} name="allowedFlavorIds" render={() => (
                <FormItem>
                  <FormLabel>Allowed Flavors</FormLabel>
                  <ScrollArea className="h-32 rounded-md border p-4">
                    {flavors.map(flavor => (
                      <FormField key={flavor.flavorId} control={form.control} name="allowedFlavorIds" render={({ field }) => (
                        <FormItem className="flex items-center space-x-3 space-y-0 mb-2">
                          <FormControl>
                            <Checkbox 
                                checked={field.value?.includes(flavor.flavorId)}
                                onCheckedChange={(checked) => {
                                    return checked
                                        ? field.onChange([...(field.value || []), flavor.flavorId])
                                        : field.onChange(field.value?.filter(id => id !== flavor.flavorId))
                                }}
                            />
                          </FormControl>
                          <FormLabel className="font-normal">{flavor.flavorName}</FormLabel>
                        </FormItem>
                      )} />
                    ))}
                  </ScrollArea>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <FormLabel>Active</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="refill-form" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
