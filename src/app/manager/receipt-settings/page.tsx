
"use client";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { ReceiptSettings } from "@/components/manager/store-settings/receipt-settings";
import { useStoreContext } from "@/context/store-context";
import { Loader } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReceiptSettingsPage() {
    const { activeStore, loading } = useStoreContext();

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to manage its receipt settings.</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Receipt Settings" description={`Customize the printed receipts for ${activeStore.name}`} />
            <ReceiptSettings store={activeStore} />
        </RoleGuard>
    );
}
