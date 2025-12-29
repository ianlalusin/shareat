
"use client";

import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { Store } from "@/lib/types";

export const receiptSettingsSchema = z.object({
  businessName: z.string(),
  branchName: z.string(),
  address: z.string(),
  contact: z.string(),
  tin: z.string().optional(),
  vatType: z.enum(["VAT", "NON_VAT"]).optional(),
  logoUrl: z.string().url().optional().nullable(),
  footerText: z.string().optional(),
  showCashierName: z.boolean().default(true),
  showServerName: z.boolean().default(true),
  showTableOrCustomer: z.boolean().default(true),
  showItemNotes: z.boolean().default(true),
  showDiscountBreakdown: z.boolean().default(true),
  showChargeBreakdown: z.boolean().default(true),
  paperWidth: z.enum(["58mm", "80mm", "A4"]).default("80mm"),
  receiptNoFormat: z.string().optional(),
});

type ReceiptSettingsFormValues = z.infer<typeof receiptSettingsSchema>;

interface ReceiptSettingsProps {
    store: Store;
    form: UseFormReturn<ReceiptSettingsFormValues>;
}

export function ReceiptSettings({ store, form }: ReceiptSettingsProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  
  const isSubmitting = form.formState.isSubmitting;

  const onSubmit = async (data: ReceiptSettingsFormValues) => {
    if (!appUser) return;
    const settingsRef = doc(db, `stores/${store.id}/receiptSettings`, "main");
    try {
      await setDoc(settingsRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
      toast({ title: "Receipt Settings Saved" });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    }
  };
  
  return (
    <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Display Options</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="showCashierName" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Cashier</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showServerName" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Server</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showTableOrCustomer" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Table/Customer</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showItemNotes" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Item Notes</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showDiscountBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Discount Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showChargeBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Charge Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Formatting</h3>
                <div className="grid md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="paperWidth" render={({ field }) => <FormItem><FormLabel>Paper Width</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="58mm">58mm (Small Thermal)</SelectItem><SelectItem value="80mm">80mm (Standard Thermal)</SelectItem><SelectItem value="A4">A4</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="receiptNoFormat" render={({ field }) => <FormItem><FormLabel>Receipt No. Format</FormLabel><FormControl><Input placeholder="e.g., SEV5-{YYYY}-{####}" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="footerText" render={({ field }) => <FormItem className="md:col-span-2"><FormLabel>Footer Text</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>} />
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                    Save Settings
                </Button>
            </div>
        </form>
    </Form>
  );
}
