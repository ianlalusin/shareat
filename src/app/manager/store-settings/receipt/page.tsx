
"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db, storage } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UploadCloud } from "lucide-react";
import { Store } from "@/app/admin/stores/page";
import Image from "next/image";
import { uploadReceiptLogo } from "@/lib/firebase/client";

const receiptSettingsSchema = z.object({
  businessName: z.string().min(1, "Business name is required."),
  branchName: z.string().min(1, "Branch name is required."),
  address: z.string().min(1, "Address is required."),
  contact: z.string().min(1, "Contact is required."),
  tin: z.string().optional(),
  vatType: z.enum(["VAT", "NON_VAT"]).default("NON_VAT"),
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

export function ReceiptSettings({ store }: { store: Store }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const form = useForm<ReceiptSettingsFormValues>({
    resolver: zodResolver(receiptSettingsSchema),
    defaultValues: {
      businessName: "",
      branchName: "",
      address: "",
      contact: "",
      vatType: "NON_VAT",
      showCashierName: true,
      showServerName: true,
      showTableOrCustomer: true,
      showItemNotes: true,
      showDiscountBreakdown: true,
      showChargeBreakdown: true,
      paperWidth: "80mm",
    }
  });
  
  const isSubmitting = form.formState.isSubmitting;
  const logoUrl = form.watch("logoUrl");

  useEffect(() => {
    const settingsRef = doc(db, `stores/${store.id}/receiptSettings`, "main");
    const unsubscribe = onSnapshot(settingsRef, (doc) => {
      if (doc.exists()) {
        form.reset(doc.data() as ReceiptSettingsFormValues);
      } else {
        // If no settings exist, pre-fill with store data
        form.reset({
            businessName: store.name || "",
            branchName: store.name || "",
            address: store.address || "",
            contact: store.contactNumber || "",
        });
      }
    });
    return () => unsubscribe();
  }, [store, form]);

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
  
   const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const url = await uploadReceiptLogo(store.id, file);
        form.setValue("logoUrl", url);
        toast({ title: "Logo Uploaded" });
    } catch (error: any) {
        toast({
            variant: "destructive",
            title: "Upload Failed",
            description: error.message || "Could not upload the logo.",
        });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt Settings</CardTitle>
        <CardDescription>Customize the information and layout of your printed receipts.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            {/* Business Info */}
            <div className="space-y-4 p-4 border rounded-lg">
              <h3 className="font-semibold">Business Information</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <FormField control={form.control} name="businessName" render={({ field }) => <FormItem><FormLabel>Business Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="branchName" render={({ field }) => <FormItem><FormLabel>Branch Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="address" render={({ field }) => <FormItem><FormLabel>Address</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="contact" render={({ field }) => <FormItem><FormLabel>Contact No.</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="tin" render={({ field }) => <FormItem><FormLabel>TIN</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="vatType" render={({ field }) => <FormItem><FormLabel>VAT Type</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="VAT">VAT</SelectItem><SelectItem value="NON_VAT">Non-VAT</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                 <FormItem>
                    <FormLabel>Logo</FormLabel>
                    <div className="flex items-center gap-4">
                        {logoUrl && <Image src={logoUrl} alt="logo" width={64} height={64} className="rounded-md object-contain border"/>}
                        <Button type="button" variant="outline" onClick={() => document.getElementById('logo-upload')?.click()}><UploadCloud className="mr-2"/>Upload</Button>
                        <Input id="logo-upload" type="file" className="hidden" onChange={handleLogoUpload} accept="image/png, image/jpeg"/>
                    </div>
                </FormItem>
              </div>
            </div>

            {/* Display Options */}
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

            {/* Formatting */}
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
      </CardContent>
    </Card>
  );
}
