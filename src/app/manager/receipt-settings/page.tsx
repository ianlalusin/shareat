
"use client";

import { useState } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { ReceiptSettings } from "@/components/manager/store-settings/receipt-settings";
import { useStoreContext } from "@/context/store-context";
import { Loader2 } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentReceiptsList } from "@/components/manager/receipts/RecentReceiptsList";
import { Separator } from "@/components/ui/separator";
import { ReceiptView, type ReceiptData } from "@/components/receipt/receipt-view";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export default function ReceiptSettingsPage() {
    const { activeStore, loading } = useStoreContext();
    const [selectedReceiptData, setSelectedReceiptData] = useState<ReceiptData | null>(null);

    const handlePrint = () => {
        if (selectedReceiptData) {
            window.print();
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>
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
            <PageHeader title="Receipt Center" description={`Manage receipt templates and browse recent transactions for ${activeStore.name}`} />
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                {/* Main Preview Panel */}
                <div className="lg:col-span-1 space-y-4">
                     <Card className="sticky top-20">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Receipt Preview</CardTitle>
                                <CardDescription>A live preview of your receipt.</CardDescription>
                            </div>
                            <Button onClick={handlePrint} disabled={!selectedReceiptData} className="no-print">
                                <Printer className="mr-2"/> Print
                            </Button>
                        </CardHeader>
                        <CardContent className="receipt-print-container bg-gray-100 dark:bg-gray-800 p-2 rounded-b-lg">
                           {selectedReceiptData ? (
                                <ReceiptView data={selectedReceiptData} />
                           ) : (
                               <div className="flex items-center justify-center h-96 text-muted-foreground">
                                   <p>Select a recent receipt to preview.</p>
                               </div>
                           )}
                        </CardContent>
                    </Card>
                </div>
                
                {/* Settings and Recent List Panel */}
                <div className="lg:col-span-2 space-y-6">
                    <ReceiptSettings store={activeStore} />
                    <Separator />
                    <RecentReceiptsList store={activeStore} onSelectReceipt={setSelectedReceiptData}/>
                </div>
            </div>
        </RoleGuard>
    );
}
