
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
import { Discount } from "./DiscountsSettings";
import { Checkbox } from "@/components/ui/checkbox";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  type: z.enum(["fixed", "percent"]),
  value: z.coerce.number().min(0, "Value cannot be negative."),
  scope: z.array(z.string()).refine(value => value.length > 0, {
    message: "You must select at least one scope (Item or Bill).",
  }),
  stackable: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(1000),
  isEnabled: z.boolean().default(true),
}).refine(data => !(data.type === 'percent' && data.value > 100), {
  message: "Percentage cannot exceed 100.",
  path: ["value"],
});


type FormValues = z.infer<typeof formSchema>;

interface DiscountEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues, isCreating: boolean) => void;
  item: Discount | null;
}

export function DiscountEditDialog({ isOpen, onClose, onSave, item }: DiscountEditDialogProps) {
  const isCreating = item === null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "fixed",
      value: 0,
      scope: ["bill"],
      stackable: false,
      sortOrder: 1000,
      isEnabled: true,
    },
  });

  useEffect(() => {
    if (item) {
      const currentScope = item.scope;
      const normalizedScope = Array.isArray(currentScope) 
        ? currentScope 
        : (typeof currentScope === 'string' ? [currentScope] : []);
      
      form.reset({
        name: item.name,
        type: item.type,
        value: item.value,
        scope: normalizedScope,
        stackable: item.stackable,
        sortOrder: item.sortOrder,
        isEnabled: item.isEnabled,
      });
    } else {
      form.reset({
        name: "",
        type: "fixed",
        value: 0,
        scope: ["bill"],
        stackable: false,
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
          <DialogTitle>{isCreating ? "Add New Discount" : "Edit Discount"}</DialogTitle>
          <DialogDescription>
            {isCreating ? "Create a new discount to apply to bills." : `Editing "${item?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="discount-form" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                    <FormLabel>Discount Name</FormLabel>
                    <FormControl><Input placeholder="e.g., Senior Citizen, PWD" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
                )} />
                <FormField
                control={form.control}
                name="scope"
                render={() => (
                    <FormItem>
                    <FormLabel>Scope</FormLabel>
                    <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 h-10">
                        <FormField
                        control={form.control}
                        name="scope"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                                <Checkbox
                                checked={field.value?.includes("item")}
                                onCheckedChange={(checked) => {
                                    return checked
                                    ? field.onChange([...field.value, "item"])
                                    : field.onChange(
                                        field.value?.filter(
                                            (value) => value !== "item"
                                        )
                                        )
                                }}
                                />
                            </FormControl>
                            <FormLabel className="font-normal">Item</FormLabel>
                            </FormItem>
                        )}
                        />
                        <FormField
                        control={form.control}
                        name="scope"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                                <Checkbox
                                checked={field.value?.includes("bill")}
                                onCheckedChange={(checked) => {
                                    return checked
                                    ? field.onChange([...field.value, "bill"])
                                    : field.onChange(
                                        field.value?.filter(
                                            (value) => value !== "bill"
                                        )
                                        )
                                }}
                                />
                            </FormControl>
                            <FormLabel className="font-normal">Bill</FormLabel>
                            </FormItem>
                        )}
                        />
                    </div>
                    <FormMessage />
                    </FormItem>
                )}
                />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed (₱)</SelectItem>
                      <SelectItem value="percent">Percent (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="value" render={({ field }) => (
                <FormItem>
                  <FormLabel>Value</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="grid grid-cols-2 gap-4">
               <FormField control={form.control} name="sortOrder" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Order</FormLabel>
                    <FormControl><Input type="number" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                 <FormField control={form.control} name="stackable" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3 h-full mt-2">
                    <FormLabel>Stackable</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
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
          <Button type="submit" form="discount-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
