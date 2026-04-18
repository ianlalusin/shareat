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
import { Checkbox } from "@/components/ui/checkbox";
import type { GlobalCharge, Store } from "@/lib/types";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  type: z.enum(["fixed", "percent"]),
  value: z.coerce.number().min(0, "Value cannot be negative."),
  appliesTo: z.enum(["subtotal", "total"]).default("subtotal"),
  scope: z.array(z.enum(["item", "bill"])).refine(v => v.length > 0, {
    message: "Select at least one scope (Item or Bill).",
  }),
  sortOrder: z.coerce.number().int().default(1000),
  isEnabled: z.boolean().default(true),
  applicableStoreIds: z.array(z.string()).min(1, "Select at least one store."),
}).refine(data => !(data.type === 'percent' && data.value > 100), {
  message: "Percentage cannot exceed 100.",
  path: ["value"],
});

type FormValues = z.infer<typeof formSchema>;

interface UniversalChargeEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues, isCreating: boolean) => void;
  item: GlobalCharge | null;
  stores: Store[];
}

export function UniversalChargeEditDialog({ isOpen, onClose, onSave, item, stores }: UniversalChargeEditDialogProps) {
  const isCreating = item === null;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      type: "fixed",
      value: 0,
      appliesTo: "subtotal",
      scope: ["bill"],
      sortOrder: 1000,
      isEnabled: true,
      applicableStoreIds: [],
    },
  });

  useEffect(() => {
    if (item) {
      const raw = (item as any).scope;
      const normalizedScope = (Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? [raw]
          : ["bill"]) as ("item" | "bill")[];
      form.reset({
        name: item.name,
        type: item.type,
        value: item.value,
        appliesTo: item.appliesTo,
        scope: normalizedScope.length > 0 ? normalizedScope : ["bill"],
        sortOrder: item.sortOrder,
        isEnabled: item.isEnabled,
        applicableStoreIds: Array.isArray(item.applicableStoreIds) ? item.applicableStoreIds : [],
      });
    } else {
      form.reset({
        name: "",
        type: "fixed",
        value: 0,
        appliesTo: "subtotal",
        scope: ["bill"],
        sortOrder: 1000,
        isEnabled: true,
        applicableStoreIds: [],
      });
    }
  }, [item, form, isOpen]);

  const handleSubmit = (data: FormValues) => {
    onSave(data, isCreating);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreating ? "Add Universal Charge" : "Edit Universal Charge"}</DialogTitle>
          <DialogDescription>
            {isCreating
              ? "Create a charge that applies across the stores you select."
              : `Editing "${item?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="universal-charge-form" className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Charge Name</FormLabel>
                <FormControl><Input placeholder="e.g., Platform Service Charge" {...field} /></FormControl>
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
              <FormField control={form.control} name="appliesTo" render={({ field }) => (
                <FormItem>
                  <FormLabel>Applies To (bill-level)</FormLabel>
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

            <FormField control={form.control} name="scope" render={() => (
              <FormItem>
                <FormLabel>Scope</FormLabel>
                <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
                  <FormField control={form.control} name="scope" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value?.includes("item")}
                          onCheckedChange={(checked) =>
                            checked
                              ? field.onChange([...(field.value || []), "item"])
                              : field.onChange(field.value?.filter((v) => v !== "item"))
                          }
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Item (per-line)</FormLabel>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="scope" render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value?.includes("bill")}
                          onCheckedChange={(checked) =>
                            checked
                              ? field.onChange([...(field.value || []), "bill"])
                              : field.onChange(field.value?.filter((v) => v !== "bill"))
                          }
                        />
                      </FormControl>
                      <FormLabel className="font-normal">Bill (whole order)</FormLabel>
                    </FormItem>
                  )} />
                </div>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="isEnabled" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <FormLabel>Enabled</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />

            <FormField
              control={form.control}
              name="applicableStoreIds"
              render={() => (
                <FormItem>
                  <FormLabel>Applies to Stores</FormLabel>
                  <div className="rounded-lg border p-3 max-h-64 overflow-y-auto space-y-2">
                    {stores.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No stores available.</p>
                    ) : stores.map(store => (
                      <FormField
                        key={store.id}
                        control={form.control}
                        name="applicableStoreIds"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value?.includes(store.id)}
                                onCheckedChange={(checked) => {
                                  return checked
                                    ? field.onChange([...(field.value || []), store.id])
                                    : field.onChange(field.value?.filter((v) => v !== store.id));
                                }}
                              />
                            </FormControl>
                            <FormLabel className="font-normal cursor-pointer">{store.name}</FormLabel>
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="universal-charge-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
