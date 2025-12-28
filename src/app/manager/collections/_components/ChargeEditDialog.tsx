
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Charge } from "./ChargesSettings";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  type: z.enum(["fixed", "percentage"]),
  value: z.coerce.number().min(0, "Value cannot be negative."),
  appliesTo: z.enum(["subtotal", "total"]).default("subtotal"),
  sortOrder: z.coerce.number().int().default(1000),
  isEnabled: z.boolean().default(true),
}).refine(data => !(data.type === 'percentage' && data.value > 100), {
  message: "Percentage cannot exceed 100.",
  path: ["value"],
});


type FormValues = z.infer<typeof formSchema>;

interface ChargeEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues, isCreating: boolean) => void;
  item: Charge | null;
}

export function ChargeEditDialog({ isOpen, onClose, onSave, item }: ChargeEditDialogProps) {
  const isCreating = item === null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "fixed",
      value: 0,
      appliesTo: "subtotal",
      sortOrder: 1000,
      isEnabled: true,
    },
  });

  useEffect(() => {
    if (item) {
      form.reset(item);
    } else {
      form.reset({
        name: "",
        type: "fixed",
        value: 0,
        appliesTo: "subtotal",
        sortOrder: 1000,
        isEnabled: true,
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
          <DialogTitle>{isCreating ? "Add New Charge" : "Edit Charge"}</DialogTitle>
          <DialogDescription>
            {isCreating ? "Create a new charge to apply to bills." : `Editing "${item?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="charge-form" className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Charge Name</FormLabel>
                <FormControl><Input placeholder="e.g., Service Charge" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed (₱)</SelectItem>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="value" render={({ field }) => (
                <FormItem>
                  <FormLabel>Value</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      step="0.01" 
                      {...field}
                      onFocus={(e) => {
                        if (parseFloat(e.target.value) === 0) {
                          e.target.value = '';
                        }
                      }}
                      onBlur={(e) => {
                         if (e.target.value === '') {
                           e.target.value = '0';
                         }
                         field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <FormField control={form.control} name="appliesTo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Applies To</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="subtotal">Subtotal</SelectItem>
                      <SelectItem value="total">Total</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
               <FormField control={form.control} name="sortOrder" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
            </div>
            
            <FormField control={form.control} name="isEnabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>Enabled</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="charge-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
