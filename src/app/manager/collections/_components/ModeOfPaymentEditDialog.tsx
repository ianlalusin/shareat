
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ModeOfPayment } from "./ModesOfPaymentSettings";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  sortOrder: z.coerce.number().int().default(1000),
  isActive: z.boolean().default(true),
  hasRef: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

interface ModeOfPaymentEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues, isCreating: boolean) => void;
  item: ModeOfPayment | null;
}

export function ModeOfPaymentEditDialog({ isOpen, onClose, onSave, item }: ModeOfPaymentEditDialogProps) {
  const isCreating = item === null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      sortOrder: 1000,
      isActive: true,
      hasRef: false,
    },
  });

  useEffect(() => {
    if (item) {
      form.reset({
        name: item.name,
        sortOrder: item.sortOrder,
        isActive: item.isActive,
        hasRef: item.hasRef || false,
      });
    } else {
      form.reset({
        name: "",
        sortOrder: 1000,
        isActive: true,
        hasRef: false,
      });
    }
  }, [item, form, isOpen]);

  const handleSubmit = (data: FormValues) => {
    onSave(data, isCreating);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreating ? "Add Mode of Payment" : "Edit Mode of Payment"}</DialogTitle>
          <DialogDescription>
            {isCreating ? "Create a new payment method for your store." : `Editing "${item?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="mop-form" className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input placeholder="e.g., GCash, PayMaya" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="sortOrder" render={({ field }) => (
              <FormItem>
                <FormLabel>Sort Order</FormLabel>
                <FormControl><Input type="number" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel>Enabled</FormLabel>
                  <FormDescription className="text-xs">
                    If disabled, this option won't appear at the cashier.
                  </FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="hasRef" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <FormLabel>Requires Reference #</FormLabel>
                  <FormDescription className="text-xs">
                    If enabled, the cashier will be prompted for a reference number.
                  </FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="mop-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
