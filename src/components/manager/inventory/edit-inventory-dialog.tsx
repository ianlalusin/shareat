
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
import { Info, Camera, Trash2, Loader2 } from "lucide-react";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db, uploadItemPhotoLocal } from "@/lib/firebase/client";
import { getAuth } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import type { Product, ProductPhotoRequest } from "@/lib/types";
import Image from "next/image";

const formSchema = z.object({
  cost: z.coerce.number().min(0, "Cost must be a positive number."),
  sellingPrice: z.coerce.number().min(0, "Selling price must be a positive number."),
  // Optional per-branch online price. NOT `z.coerce.number()` — coercion
  // turns null into 0, which is exactly the "no override" state we must
  // preserve.
  onlinePrice: z.number().min(0, "Online price cannot be negative.").nullable().optional(),
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
  storeId: string;
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
 * Optional per-branch online price.
 *
 * Deliberately NOT built on `CurrencyFormField`: that one coerces a blank
 * input to 0 on blur, which here would destroy the "no override" state.
 * Blank must stay blank and save as `null`, so the storefront falls back to
 * the dine-in selling price.
 */
function OnlinePriceFormField({ form, item }: { form: any; item: InventoryItem }) {
    const [displayValue, setDisplayValue] = React.useState(() => {
        const v = form.getValues("onlinePrice");
        return v == null ? "" : String(v);
    });

    React.useEffect(() => {
        const v = form.getValues("onlinePrice");
        setDisplayValue(v == null ? "" : String(v));
    }, [form, item]);

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
            name="onlinePrice"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Online Price (per {item.uom})</FormLabel>
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

function PhotoTab({ item, storeId }: { item: InventoryItem; storeId: string }) {
  const { toast } = useToast();
  const [globalImageUrl, setGlobalImageUrl] = React.useState<string | null>(null);
  const [request, setRequest] = React.useState<ProductPhotoRequest | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "products", item.productId)).then((snap) => {
      if (cancelled) return;
      setGlobalImageUrl(snap.exists() ? ((snap.data() as Product).imageUrl ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [item.productId]);

  React.useEffect(() => {
    const reqId = `${storeId}_${item.productId}`;
    const unsub = onSnapshot(doc(db, "productPhotoRequests", reqId), (snap) => {
      setRequest(snap.exists() ? ({ id: snap.id, ...snap.data() } as ProductPhotoRequest) : null);
    });
    return unsub;
  }, [storeId, item.productId]);

  const effectiveImageUrl = item.imageUrl ?? globalImageUrl;
  const isLocal = !!item.imageUrl;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const imageUrl = await uploadItemPhotoLocal(item.productId, storeId, file);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "submit", storeId, productId: item.productId, imageUrl }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to submit photo.");
      toast({ title: "Photo submitted", description: "Sent for admin review. It's already showing at your store." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload failed", description: err?.message || "Something went wrong." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    setIsUploading(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "remove", storeId, productId: item.productId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to remove photo.");
      toast({ title: "Photo removed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Remove failed", description: err?.message || "Something went wrong." });
    } finally {
      setIsUploading(false);
    }
  };

  const statusLabel = !request
    ? null
    : request.status === "pending"
      ? "Pending admin review"
      : request.status === "approved"
        ? "Live for every store"
        : "Rejected by admin — upload a different photo?";

  return (
    <div className="space-y-4">
      <div className="w-32 h-32 rounded-md bg-muted flex items-center justify-center relative mx-auto overflow-hidden">
        {effectiveImageUrl ? (
          <Image src={effectiveImageUrl} alt={item.name} fill style={{ objectFit: "cover" }} />
        ) : (
          <Camera className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      {effectiveImageUrl && !isLocal && (
        <p className="text-xs text-center text-muted-foreground">Inherited from the global catalog photo.</p>
      )}
      {statusLabel && <p className="text-xs text-center font-medium">{statusLabel}</p>}
      <div className="flex justify-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {isLocal ? "Replace photo" : "Upload photo"}
        </Button>
        {isLocal && (
          <Button type="button" variant="ghost" size="sm" disabled={isUploading} onClick={handleRemove}>
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      <p className="text-xs text-muted-foreground text-center">
        This photo shows at your store immediately. An admin can promote it to be every store's default, or reject it.
      </p>
    </div>
  );
}

export function EditInventoryDialog({ isOpen, onClose, item, storeId, onSave, onToggle, isSubmitting, kitchenLocations }: EditInventoryDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(refinedFormSchema),
    defaultValues: {
      cost: item.cost || 0,
      sellingPrice: item.sellingPrice || 0,
      onlinePrice: item.onlinePrice ?? null,
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
    // persist as an explicit null ("no online override").
    onSave(item, { ...data, onlinePrice: data.onlinePrice ?? null });
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
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="in-store">In-Store</TabsTrigger>
                <TabsTrigger value="online">Online</TabsTrigger>
                <TabsTrigger value="customer">Customer</TabsTrigger>
                <TabsTrigger value="photo">Photo</TabsTrigger>
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
                <OnlinePriceFormField form={form} item={item} />
              </TabsContent>

              <TabsContent value="customer" className="space-y-4">
                <AvailabilitySwitch
                  label="Customer App Enabled"
                  description="Offer this item on the customer app."
                  checked={customerEnabled}
                  onCheckedChange={() => handleToggleClick("customerEnabled")}
                />
                <p className="text-xs text-muted-foreground">
                  Always charges the store price (₱{Number(form.watch("sellingPrice") ?? item.sellingPrice ?? 0).toFixed(2)}) — there's no separate customer app price, so it can never drift from the counter.
                </p>
              </TabsContent>

              <TabsContent value="photo" className="space-y-4">
                <PhotoTab item={item} storeId={storeId} />
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
