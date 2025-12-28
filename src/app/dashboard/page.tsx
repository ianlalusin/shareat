
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/page-header";
import { DollarSign, Package, ShoppingCart, Users, Trash2, Loader2, Download } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Button } from "@/components/ui/button";
import { clearStoreTestData } from "@/lib/firebase/test-data";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import backendJson from "../../../docs/backend.json";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export default function DashboardPage() {
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const { confirm, Dialog } = useConfirmDialog();
    const [isClearing, setIsClearing] = useState(false);
    const { toast } = useToast();

    // Helper to format numbers with commas
    const formatNumber = (num: number) => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    };
    
    const totalRevenue = 45231.89;
    const totalOrders = 2350;

    const handleClearData = async () => {
        if (!activeStore) {
            toast({ variant: "destructive", title: "No store selected!" });
            return;
        }
        const confirmed = await confirm({
            title: `Clear ALL Test Data for ${activeStore.name}?`,
            description: "This will delete all sessions and reset all tables to 'available'. This action is irreversible.",
            confirmText: "Yes, Clear All Data",
            destructive: true,
        });

        if (!confirmed) return;

        setIsClearing(true);
        try {
            await clearStoreTestData(activeStore.id);
            toast({ title: "Test Data Cleared", description: `All sessions and tables for ${activeStore.name} have been reset.`});
        } catch (error: any) {
            toast({ variant: "destructive", title: "Error Clearing Data", description: error.message });
        } finally {
            setIsClearing(false);
        }
    }

    const downloadFirestoreTree = () => {
        try {
            const structure = (backendJson.firestore as any)?.structure;
            if (!structure || !Array.isArray(structure)) {
                toast({ variant: "destructive", title: "Error", description: "Could not find Firestore structure in backend.json." });
                return;
            }

            const paths = structure.map(item => item.path);
            let tree = '/\n';
            const rootLevel = new Set<string>();
            const subLevels: Record<string, string[]> = {};

            paths.forEach(path => {
                const parts = path.substring(1).split('/');
                if (parts.length === 2) {
                    rootLevel.add(parts[0]);
                } else if (parts.length > 2) {
                    const root = parts[0];
                    if (!subLevels[root]) {
                        subLevels[root] = [];
                    }
                    subLevels[root].push(path.substring(path.indexOf('/', 1)));
                }
            });

            const sortedRoots = Array.from(rootLevel).sort();
            sortedRoots.forEach((root, index) => {
                const isLastRoot = index === sortedRoots.length - 1;
                tree += `${isLastRoot ? '└──' : '├──'} ${root}/{${root.slice(0, -1)}Id}\n`;
                
                if (subLevels[root]) {
                    const sortedSubs = subLevels[root].sort();
                    sortedSubs.forEach((sub, subIndex) => {
                        const isLastSub = subIndex === sortedSubs.length - 1;
                        const subPath = sub.substring(1).replace(new RegExp(`\\{${root.slice(0, -1)}Id\\}`), '');
                        tree += `${isLastRoot ? '    ' : '│   '}${isLastSub ? '└──' : '├──'} ${subPath}\n`;
                    });
                }
            });
            
            const blob = new Blob([tree], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'firestore_schema.txt';
            document.body.appendChild(a);
a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast({ title: "Schema Downloaded", description: "Firestore collection tree has been downloaded." });

        } catch (e: any) {
            toast({ variant: "destructive", title: "Failed to generate schema", description: e.message });
        }
    };

    return (
        <>
            <PageHeader title="Dashboard" description="Here's a summary of your restaurant's activity.">
                <div className="flex items-center gap-2">
                    <DateRangePicker />
                    <Button variant="outline" onClick={downloadFirestoreTree}>
                        <Download className="mr-2"/>
                        Download Schema
                    </Button>
                    {(appUser?.role === 'admin' || appUser?.role === 'manager') && (
                        <Button variant="destructive" onClick={handleClearData} disabled={isClearing}>
                            {isClearing ? <Loader2 className="animate-spin mr-2" /> : <Trash2 className="mr-2"/>}
                            Clear Store Test Data
                        </Button>
                    )}
                </div>
            </PageHeader>
            <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Total Revenue
                    </CardTitle>
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">₱{totalRevenue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                    <p className="text-xs text-muted-foreground">
                        +20.1% from last month
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Orders
                    </CardTitle>
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">+{formatNumber(totalOrders)}</div>
                    <p className="text-xs text-muted-foreground">
                        +180.1% from last month
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Menu Items
                    </CardTitle>
                    <Package className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">128</div>
                    <p className="text-xs text-muted-foreground">
                        +19 from last month
                    </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                        Active Staff
                    </CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                    <div className="text-2xl font-bold">12</div>
                    <p className="text-xs text-muted-foreground">
                        +2 since last hour
                    </p>
                    </CardContent>
                </Card>
            </div>
            {/* Additional dashboard components can be added here */}
            {Dialog}
        </>
    )
}
