
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
import { Info } from "lucide-react";

const formSchema = z.object({
  cost: z.coerce.number().min(0, "Cost must be a positive number."),
  sellingPrice: z.coerce.number().min(0, "Selling price must be a positive number."),
  kitchenLocationId: z.string().nullable().optional(),
});

// We need a conditional validator
const refinedFormSchema = (isAddon: boolean) => formSchema.refine(
  (data) => {
    if (isAddon) {
      return data.sellingPrice > 0;
    }
    return true;
  },
  {
    message: "Selling price must be greater than 0 for an add-on.",
    path: ["sellingPrice"],
  }
).refine(
    (data) => {
        if (isAddon) {
            return !!data.kitchenLocationId;
        }
        return true;
    },
    {
        message: "Kitchen location is required for an add-on.",
        path: ["kitchenLocationId"],
    }
);


type FormValues = z.infer<typeof formSchema>;

interface EditInventoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  kitchenLocations: KitchenLocation[];
  onSave: (item: InventoryItem, data: any) => void;
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

export function EditInventoryDialog({ isOpen, onClose, item, onSave, isSubmitting, kitchenLocations }: EditInventoryDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(refinedFormSchema(item.isAddon || false)),
    defaultValues: {
      cost: item.cost || 0,
      sellingPrice: item.sellingPrice || 0,
      kitchenLocationId: item.kitchenLocationId || null,
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset({
        cost: item.cost || 0,
        sellingPrice: item.sellingPrice || 0,
        kitchenLocationId: item.kitchenLocationId || null,
      });
    }
  }, [isOpen, item, form]);

  const onSubmit = (data: FormValues) => {
    onSave(item, data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Inventory Item: {item.name}</DialogTitle>
          <DialogDescription>Update pricing and kitchen assignment for this item.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} id="edit-item-form" className="space-y-4">
            {item.isAddon && (
                <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Add-on Requirements</AlertTitle>
                    <AlertDescription>
                        A selling price and kitchen location must be set for items marked as add-ons.
                    </AlertDescription>
                </Alert>
            )}
            <CurrencyFormField name="cost" label="Cost" form={form} uom={item.uom} />
            <CurrencyFormField name="sellingPrice" label="Selling Price" form={form} uom={item.uom} />
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
