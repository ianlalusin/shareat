"use client";

import { useEffect } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Printer } from "lucide-react";
import type { Store } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import { receiptSettingsSchema } from "@/lib/receipts/receipt-settings";

type ReceiptSettingsFormValues = z.infer<typeof receiptSettingsSchema>;

interface ReceiptSettingsProps {
    store: Store;
    onTestPrint?: () => void;
}

export function ReceiptSettings({ store, onTestPrint }: ReceiptSettingsProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { settings, isLoading: settingsLoading } = useReceiptSettings(store.id);

  const form = useForm<ReceiptSettingsFormValues>({
    resolver: zodResolver(receiptSettingsSchema),
    defaultValues: settings,
  });

  useEffect(() => {
    if (settings && !form.formState.isSubmitting) {
        form.reset(settings);
    }
  }, [settings, form]);
  
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
  
  if (settingsLoading) {
      return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin" /></div>
  }

  return (
    <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Display Options</h3>
                    {onTestPrint && (
                        <Button type="button" variant="outline" size="sm" onClick={onTestPrint}>
                            <Printer className="mr-2 h-4 w-4" /> Print Test Receipt
                        </Button>
                    )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="showCashierName" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Cashier</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showTableOrCustomer" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Table/Customer</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showItemNotes" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Item Notes</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showDiscountBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Discount Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showChargeBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Charge Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Logo & Font</h3>
                <div className="grid md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="showLogo" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Logo</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="logoWidthPct" render={({ field }) => <FormItem><FormLabel>Logo Width (%)</FormLabel><Select onValueChange={(val) => field.onChange(Number(val))} value={String(field.value ?? 80)}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="50">50%</SelectItem><SelectItem value="60">60%</SelectItem><SelectItem value="70">70%</SelectItem><SelectItem value="80">80%</SelectItem><SelectItem value="90">90%</SelectItem><SelectItem value="100">100%</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="fontFamily" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Font Family</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="'Courier New', Courier, monospace">Courier New</SelectItem>
                                    <SelectItem value="'Lucida Console', Monaco, monospace">Lucida Console</SelectItem>
                                    <SelectItem value="monospace">Monospace</SelectItem>
                                    <SelectItem value="sans-serif">Sans-Serif</SelectItem>
                                    <SelectItem value="serif">Serif</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="fontSize" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Font Size: {field.value ?? 12}px</FormLabel>
                            <FormControl>
                                <Slider
                                    value={[field.value ?? 12]}
                                    onValueChange={(value) => field.onChange(value[0])}
                                    min={8}
                                    max={16}
                                    step={1}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Formatting & Behavior</h3>
                 <div className="grid md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="paperWidth" render={({ field }) => <FormItem><FormLabel>Paper Width</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="58mm">58mm (Small Thermal)</SelectItem><SelectItem value="80mm">80mm (Standard Thermal)</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="receiptNoFormat" render={({ field }) => <FormItem><FormLabel>Receipt No. Format</FormLabel><FormControl><Input placeholder="e.g., SEV5-{YYYY}-{####}" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="footerText" render={({ field }) => <FormItem className="md:col-span-2"><FormLabel>Footer Text</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
                     <FormField control={form.control} name="autoPrintAfterPayment" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3 col-span-2"><FormLabel>Auto-print after payment</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
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
