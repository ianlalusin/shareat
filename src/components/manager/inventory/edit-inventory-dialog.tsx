
"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { InventoryItem } from "@/app/manager/inventory/page";

const formSchema = z.object({
  cost: z.coerce.number().min(0, "Cost must be a positive number."),
  sellingPrice: z.coerce.number().min(0, "Price must be a positive number."),
});

type FormValues = z.infer<typeof formSchema>;

interface EditInventoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  onSave: (item: InventoryItem, data: FormValues) => void;
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

export function EditInventoryDialog({ isOpen, onClose, item, onSave, isSubmitting }: EditInventoryDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      cost: item.cost || 0,
      sellingPrice: item.sellingPrice || 0,
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset({
        cost: item.cost || 0,
        sellingPrice: item.sellingPrice || 0,
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
          <DialogDescription>Update the cost and selling price for this item.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} id="edit-item-form" className="space-y-4">
            <CurrencyFormField name="cost" label="Cost" form={form} uom={item.uom} />
            <CurrencyFormField name="sellingPrice" label="Selling Price" form={form} uom={item.uom} />
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
