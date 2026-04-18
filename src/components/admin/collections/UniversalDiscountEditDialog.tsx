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
import type { GlobalDiscount, Store } from "@/lib/types";

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().or(z.literal(""));

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  type: z.enum(["fixed", "percent"]),
  value: z.coerce.number().min(0, "Value cannot be negative."),
  scope: z.array(z.enum(["item", "bill"])).refine(value => value.length > 0, {
    message: "You must select at least one scope (Item or Bill).",
  }),
  stackable: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(1000),
  isEnabled: z.boolean().default(true),
  applicableStoreIds: z.array(z.string()).min(1, "Select at least one store."),
  startDate: dateStringSchema,
  endDate: dateStringSchema,
}).refine(data => !(data.type === 'percent' && data.value > 100), {
  message: "Percentage cannot exceed 100.",
  path: ["value"],
}).refine(data => {
  if (!data.startDate || !data.endDate) return true;
  return data.startDate <= data.endDate;
}, {
  message: "End date must be on or after start date.",
  path: ["endDate"],
});

type FormValues = z.infer<typeof formSchema>;

interface UniversalDiscountEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues, isCreating: boolean) => void;
  item: GlobalDiscount | null;
  stores: Store[];
}

export function UniversalDiscountEditDialog({ isOpen, onClose, onSave, item, stores }: UniversalDiscountEditDialogProps) {
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
      applicableStoreIds: [],
      startDate: "",
      endDate: "",
    },
  });

  useEffect(() => {
    if (item) {
      const currentScope = item.scope;
      const normalizedScope = (Array.isArray(currentScope)
        ? currentScope
        : (typeof currentScope === 'string' ? [currentScope] : [])) as ("item" | "bill")[];

      form.reset({
        name: item.name,
        type: item.type,
        value: item.value,
        scope: normalizedScope,
        stackable: item.stackable,
        sortOrder: item.sortOrder,
        isEnabled: item.isEnabled,
        applicableStoreIds: Array.isArray(item.applicableStoreIds) ? item.applicableStoreIds : [],
        startDate: item.startDate || "",
        endDate: item.endDate || "",
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
        applicableStoreIds: [],
        startDate: "",
        endDate: "",
      });
    }
  }, [item, form, isOpen]);

  const handleSubmit = (data: FormValues) => {
    // Persist "" for cleared dates so existing docs overwrite to empty
    // (undefined would be skipped by Firestore, leaving stale dates).
    onSave(data, isCreating);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isCreating ? "Add Universal Discount" : "Edit Universal Discount"}</DialogTitle>
          <DialogDescription>
            {isCreating
              ? "Create a discount that applies across the stores you select."
              : `Editing "${item?.name}"`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="universal-discount-form" className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount Name</FormLabel>
                  <FormControl><Input placeholder="e.g., Platform Senior Citizen" {...field} /></FormControl>
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
                                    ? field.onChange([...(field.value || []), "item"])
                                    : field.onChange(field.value?.filter((v) => v !== "item"));
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
                                    ? field.onChange([...(field.value || []), "bill"])
                                    : field.onChange(field.value?.filter((v) => v !== "bill"));
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

            <div className="rounded-lg border p-3 space-y-2">
              <FormLabel>Availability window (optional)</FormLabel>
              <p className="text-xs text-muted-foreground">
                When both dates are set, the discount is only applied on dates between them (inclusive). Leave blank for always-on.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="startDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="endDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>End date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

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
          <Button type="submit" form="universal-discount-form">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
