
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useStoreConfigDoc } from "@/hooks/useStoreConfigDoc";
import { rebuildStoreConfig } from "@/lib/manager/dataManagement";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, RefreshCw } from "lucide-react";
import { toJsDate } from "@/lib/utils/date";

export default function DataManagementPage() {
    const router = useRouter();
    const { activeStore } = useStoreContext();
    const { toast } = useToast();
    const [isRebuilding, setIsRebuilding] = useState(false);
    
    const { config: storeConfig, isLoading: isConfigLoading } = useStoreConfigDoc(activeStore?.id);

    const lastUpdated = storeConfig?.meta?.updatedAt ? toJsDate(storeConfig.meta.updatedAt) : null;

    const handleRebuild = async () => {
        if (!activeStore) return;
        setIsRebuilding(true);
        toast({ title: "Rebuilding Cache...", description: "This may take a moment." });
        try {
            await rebuildStoreConfig(db, activeStore.id);
            toast({ title: "Success!", description: "The store configuration cache has been rebuilt." });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Rebuild Failed", description: error.message });
        } finally {
            setIsRebuilding(false);
        }
    };
    
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Data Management" description="Tools for maintaining and optimizing store data.">
                 <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
            </PageHeader>
            <Card className="mt-6 max-w-2xl">
                <CardHeader>
                    <CardTitle>Store Configuration Cache</CardTitle>
                    <CardDescription>
                        The app uses a single 'config' document to load tables, packages, discounts, etc. quickly. 
                        If you've made manual changes or suspect data is out of sync, you can rebuild this cache.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="p-4 bg-muted rounded-lg text-sm">
                        <p><span className="font-semibold">Current Store:</span> {activeStore?.name}</p>
                        <p><span className="font-semibold">Last Rebuilt:</span> {isConfigLoading ? 'Loading...' : (lastUpdated ? format(lastUpdated, "PPP p") : 'Never')}</p>
                    </div>
                     <Button onClick={handleRebuild} disabled={isRebuilding || !activeStore} className="w-full">
                        {isRebuilding ? <Loader2 className="mr-2 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Rebuild Configuration Cache
                    </Button>
                </CardContent>
            </Card>
        </RoleGuard>
    );
}
