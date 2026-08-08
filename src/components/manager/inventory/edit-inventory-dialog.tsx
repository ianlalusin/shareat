
"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { InventoryItem, KitchenLocation } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info } from "lucide-react";

const formSchema = z.object({
  cost: z.coerce.number().min(0, "Cost must be a positive number."),
  sellingPrice: z.coerce.number().min(0, "Selling price must be a positive number."),
  // Optional per-branch online/customer price. NOT `z.coerce.number()` —
  // coercion turns null into 0, which is exactly the "no override" state we
  // must preserve.
  onlinePrice: z.number().min(0, "Online price cannot be negative.").nullable().optional(),
  customerPrice: z.number().min(0, "Customer price cannot be negative.").nullable().optional(),
  isAddon: z.boolean(),
  kitchenLocationId: z.string().nullable().optional(),
});

/**
 * The add-on requirements validate against what the manager is setting in
 * this form, not against the item's saved state — enabling the switch must
 * immediately demand a price and a kitchen.
 */
const refinedFormSchema = formSchema.superRefine((data, ctx) => {
  if (!data.isAddon) return;
  if (data.sellingPrice <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sellingPrice"],
      message: "Selling price must be greater than 0 for an add-on.",
    });
  }
  if (!data.kitchenLocationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["kitchenLocationId"],
      message: "Kitchen location is required for an add-on.",
    });
  }
});

type FormValues = z.infer<typeof formSchema>;
type ToggleField = "isActive" | "onlineEnabled" | "customerEnabled";

interface EditInventoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  kitchenLocations: KitchenLocation[];
  onSave: (item: InventoryItem, data: any) => void;
  onToggle: (item: InventoryItem, field: ToggleField) => void;
  isSubmitting: boolean;
}

function CurrencyFormField({ name, label, form, uom }: { name: "cost" | "sellingPrice", label: string, form: any, uom: string }) {
    const [displayValue, setDisplayValue] = React.useState(form.getValues(name)?.toString() || '0');

    React.useEffect(() => {
        const initialValue = form.getValues(name);
        setDisplayValue(initialValue?.toString() || '0');
    }, [form, name]);

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        if (parseFloat(e.target.value) === 0) {
            setDisplayValue('');
        }
    };

    const handleBlur = (field: any) => () => {
        let numericValue = parseFloat(displayValue);
        if (isNaN(numericValue) || displayValue === '') {
            numericValue = 0;
            setDisplayValue('0');
        }
        field.onChange(numericValue);
    };

    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label} (per {uom})</FormLabel>
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                            ₱
                        </span>
                        <FormControl>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                className="pl-7"
                                value={displayValue}
                                onChange={(e) => setDisplayValue(e.target.value)}
                                onFocus={handleFocus}
                                onBlur={handleBlur(field)}
                            />
                        </FormControl>
                    </div>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

/**
 * Optional per-branch channel price (Online or Customer app).
 *
 * Deliberately NOT built on `CurrencyFormField`: that one coerces a blank
 * input to 0 on blur, which here would destroy the "no override" state.
 * Blank must stay blank and save as `null`, so the channel falls back to the
 * dine-in selling price.
 */
function ChannelPriceFormField({
  form,
  item,
  name,
  label,
}: {
  form: any;
  item: InventoryItem;
  name: "onlinePrice" | "customerPrice";
  label: string;
}) {
    const [displayValue, setDisplayValue] = React.useState(() => {
        const v = form.getValues(name);
        return v == null ? "" : String(v);
    });

    React.useEffect(() => {
        const v = form.getValues(name);
        setDisplayValue(v == null ? "" : String(v));
    }, [form, item, name]);

    // Track the value being saved, not the stored one — if the manager is also
    // editing the selling price, that is what "leave blank to match" will mean.
    const dineIn = Number(form.watch("sellingPrice") ?? item.sellingPrice ?? 0);

    const handleBlur = (field: any) => () => {
        const raw = displayValue.trim();
        const numericValue = parseFloat(raw);
        if (raw === "" || isNaN(numericValue)) {
            setDisplayValue("");
            field.onChange(null);
            return;
        }
        field.onChange(numericValue);
    };

    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label} (per {item.uom})</FormLabel>
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
                            ₱
                        </span>
                        <FormControl>
                            <Input
                                type="number"
                                step="0.01"
                                placeholder="Same as selling price"
                                className="pl-7"
                                value={displayValue}
                                onChange={(e) => setDisplayValue(e.target.value)}
                                onBlur={handleBlur(field)}
                            />
                        </FormControl>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Dine-in: ₱{(isNaN(dineIn) ? 0 : dineIn).toFixed(2)} — leave blank to match.
                        Enter 0 to keep it hidden there.
                    </p>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

/** Instant-write availability switch — mirrors the table's toggle behavior. */
function AvailabilitySwitch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
      <div className="space-y-0.5">
        <p className="text-sm font-medium leading-none">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function EditInventoryDialog({ isOpen, onClose, item, onSave, onToggle, isSubmitting, kitchenLocations }: EditInventoryDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(refinedFormSchema),
    defaultValues: {
      cost: item.cost || 0,
      sellingPrice: item.sellingPrice || 0,
      onlinePrice: item.onlinePrice ?? null,
      customerPrice: item.customerPrice ?? null,
      isAddon: !!item.isAddon,
      kitchenLocationId: item.kitchenLocationId || null,
    },
  });

  // Toggles are instant-write (same as the table), so they're tracked as local
  // display state seeded from `item` rather than form fields — flipping one
  // must not wait for "Save Changes", and must not be reverted by it either.
  const [isActive, setIsActive] = React.useState(!!item.isActive);
  const [onlineEnabled, setOnlineEnabled] = React.useState(item.onlineEnabled === true);
  const [customerEnabled, setCustomerEnabled] = React.useState(item.customerEnabled === true);

  React.useEffect(() => {
    if (!isOpen) return;
    form.reset({
      cost: item.cost || 0,
      sellingPrice: item.sellingPrice || 0,
      onlinePrice: item.onlinePrice ?? null,
      customerPrice: item.customerPrice ?? null,
      isAddon: !!item.isAddon,
      kitchenLocationId: item.kitchenLocationId || null,
    });
    setIsActive(!!item.isActive);
    setOnlineEnabled(item.onlineEnabled === true);
    setCustomerEnabled(item.customerEnabled === true);
  }, [isOpen, item, form]);

  const handleToggleClick = (field: ToggleField) => {
    onToggle(item, field);
    if (field === "isActive") setIsActive((v) => !v);
    if (field === "onlineEnabled") setOnlineEnabled((v) => !v);
    if (field === "customerEnabled") setCustomerEnabled((v) => !v);
  };

  const onSubmit = (data: FormValues) => {
    // Never hand Firestore an `undefined` — an untouched blank field must
    // persist as an explicit null ("no channel override").
    onSave(item, { ...data, onlinePrice: data.onlinePrice ?? null, customerPrice: data.customerPrice ?? null });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Inventory Item: {item.name}</DialogTitle>
          <DialogDescription>Set up, price, and control where this item is sold.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} id="edit-item-form">
            <Tabs defaultValue="setup" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="in-store">In-Store</TabsTrigger>
                <TabsTrigger value="online">Online</TabsTrigger>
                <TabsTrigger value="customer">Customer</TabsTrigger>
              </TabsList>

              <TabsContent value="setup" className="space-y-4">
                {form.watch("isAddon") && (
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertTitle>Add-on Requirements</AlertTitle>
                        <AlertDescription>
                            A selling price and kitchen location must be set for items marked as add-ons.
                        </AlertDescription>
                    </Alert>
                )}
                <FormField
                  control={form.control}
                  name="kitchenLocationId"
                  render={({ field }) => (
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
                  )}
                />
                <FormField
                  control={form.control}
                  name="isAddon"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Add-on</FormLabel>
                        <p className="text-xs text-muted-foreground">
                          Offer this as an add-on at the counter. Needs a selling price and a kitchen location.
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="in-store" className="space-y-4">
                <AvailabilitySwitch
                  label="Active"
                  description="Sold at the counter for dine-in and takeout."
                  checked={isActive}
                  onCheckedChange={() => handleToggleClick("isActive")}
                />
                <CurrencyFormField name="cost" label="Cost" form={form} uom={item.uom} />
                <CurrencyFormField name="sellingPrice" label="Selling Price" form={form} uom={item.uom} />
              </TabsContent>

              <TabsContent value="online" className="space-y-4">
                <AvailabilitySwitch
                  label="Online Enabled"
                  description="Offer this item on the public website."
                  checked={onlineEnabled}
                  onCheckedChange={() => handleToggleClick("onlineEnabled")}
                />
                <ChannelPriceFormField form={form} item={item} name="onlinePrice" label="Online Price" />
              </TabsContent>

              <TabsContent value="customer" className="space-y-4">
                <AvailabilitySwitch
                  label="Customer App Enabled"
                  description="Offer this item on the customer app."
                  checked={customerEnabled}
                  onCheckedChange={() => handleToggleClick("customerEnabled")}
                />
                <ChannelPriceFormField form={form} item={item} name="customerPrice" label="Customer Price" />
              </TabsContent>
            </Tabs>
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="edit-item-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
