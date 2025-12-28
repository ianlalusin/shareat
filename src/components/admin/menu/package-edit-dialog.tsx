
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Package } from "@/app/admin/menu/packages/page";
import { Refill } from "@/app/admin/menu/refills/page";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  allowedRefillIds: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
});

type FormValues = z.infer<typeof formSchema>;

interface PackageEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: FormValues) => void;
  item: Package | null;
  isSubmitting: boolean;
  refills: Refill[];
}

export function PackageEditDialog({ isOpen, onClose, onSave, item, isSubmitting, refills }: PackageEditDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", allowedRefillIds: [], isActive: true },
  });

  useEffect(() => {
    if (isOpen) {
      if (item) {
        form.reset({
            name: item.name,
            allowedRefillIds: item.allowedRefillIds || [],
            isActive: item.isActive,
        });
      } else {
        form.reset({ name: "", allowedRefillIds: [], isActive: true });
      }
    }
  }, [item, form, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Package" : "Create New Package"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} id="package-form" className="space-y-4 py-2">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Package Name</FormLabel>
                <FormControl><Input {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            
            <FormField control={form.control} name="allowedRefillIds" render={() => (
                <FormItem>
                    <FormLabel>Allowed Refills</FormLabel>
                    <ScrollArea className="h-40 rounded-md border p-4">
                        {refills.filter(r => r.isActive).map(refill => (
                            <FormField key={refill.id} control={form.control} name="allowedRefillIds" render={({ field }) => (
                                <FormItem className="flex items-center space-x-3 space-y-0 mb-2">
                                    <FormControl>
                                        <Checkbox 
                                            checked={field.value?.includes(refill.id)}
                                            onCheckedChange={(checked) => {
                                                return checked
                                                    ? field.onChange([...(field.value || []), refill.id])
                                                    : field.onChange(field.value?.filter(id => id !== refill.id))
                                            }}
                                        />
                                    </FormControl>
                                    <FormLabel className="font-normal">{refill.name}</FormLabel>
                                </FormItem>
                            )} />
                        ))}
                    </ScrollArea>
                </FormItem>
            )} />

            <Separator />
            
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                <FormLabel>Active</FormLabel>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )} />
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="package-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    