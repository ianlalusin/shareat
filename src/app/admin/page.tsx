"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCog, Package, Store, Globe, Archive, UtensilsCrossed, Sparkles, Box, SlidersHorizontal, ClipboardList, LineChart, Wallet, Receipt, Wrench, DatabaseZap, ShieldCheck, Printer } from "lucide-react";
import { AppUser, useAuthContext } from "@/context/auth-context";
import { RoleGuard } from "@/components/guards/RoleGuard";
import dynamic from 'next/dynamic';

const adminTools = [
    { title: "Staff Management", description: "Manage staff roles, permissions, and verify accounts.", href: "/admin/users", icon: UserCog },
    { title: "Store Management", description: "Create, edit, or deactivate store locations.", href: "/admin/stores", icon: Store },
    { title: "Universal Collections", description: "Manage platform-wide discounts, charges, and store overrides.", href: "/admin/collections", icon: Globe },
]

const menuTools = [
    { title: "Products", description: "Define and categorize all available products.", href: "/admin/menu/products", icon: Package },
    { title: "Flavors", description: "Manage available flavor options.", href: "/admin/menu/flavors", icon: Sparkles },
    { title: "Refills", description: "Define and manage refillable items.", href: "/admin/menu/refills", icon: UtensilsCrossed },
    { title: "Packages", description: "Create and manage product packages.", href: "/admin/menu/packages", icon: Box },
]

const managerTools = [
    { title: "Store Settings", description: "Manage add-ons, packages, and prices.", href: "/manager/store-settings", icon: SlidersHorizontal },
    { title: "Collections", description: "Manage payments, charges, and discounts.", href: "/manager/collections", icon: Wallet },
    { title: "Inventory Management", description: "Manage stock levels and reorder points.", href: "/manager/inventory", icon: Archive },
    { title: "Receipts & History", description: "Browse, reprint, or edit past transactions.", href: "/receipts", icon: Receipt },
    { title: "Activity Logs", description: "View audit trails for all store activities.", href: "/logs", icon: ClipboardList },
    { title: "Sales Reports", description: "Analyze sales data and trends.", href: "/dashboard", icon: LineChart },
    { title: "Printer Setup", description: "Configure Bluetooth thermal printers.", href: "/admin/tools/printer-test", icon: Printer },
    { title: "Data Management", description: "Sync config caches for fast POS reads.", href: "/manager/data-management", icon: Wrench },
]

const dataTools = [
    { title: "Reconciliation Tool", description: "Verify analytics data against receipts.", href: "/admin/reconcile", icon: ShieldCheck },
    { title: "Analytics Backfill", description: "Rebuild daily analytics from receipts.", href: "/admin/backfill", icon: DatabaseZap },
]

function ToolCard({ title, description, href, icon: Icon }: { title: string, description: string, href: string, icon: React.ElementType }) {
    return (
        <Link href={href}>
            <Card className="h-full hover:bg-muted/50 transition-colors">
                <CardHeader>
                    <div className="flex items-center gap-4">
                        <Icon className="h-6 w-6 text-muted-foreground" />
                        <div>
                            <CardTitle>{title}</CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
            </Card>
        </Link>
    )
}


export default function AdminPage() {
    const { appUser } = useAuthContext();

    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Admin & Manager Hub" description="Global configurations and store-level operations." />
            <div className="grid gap-6">
                {appUser?.isPlatformAdmin && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>Global Settings & Tools</CardTitle>
                                <CardDescription>Access tools for global system configuration and maintenance.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {adminTools.map(tool => (
                                    <ToolCard key={tool.title} {...tool} />
                                ))}
                            </CardContent>
                        </Card>
                        
                        <Card>
                            <CardHeader>
                                <CardTitle>Menu Hub</CardTitle>
                                <CardDescription>Manage global menu components like schedules, flavors, and packages.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {menuTools.map(tool => (
                                    <ToolCard key={tool.title} {...tool} />
                                ))}
                            </CardContent>
                        </Card>
                    </>
                )}

                {(appUser?.isPlatformAdmin || appUser?.role === 'manager') && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>Manager Tools</CardTitle>
                                <CardDescription>Oversee and manage your store's operations, settings, and collections.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {managerTools.map(tool => (
                                    <ToolCard key={tool.title} {...tool} />
                                ))}
                            </CardContent>
                        </Card>
                    </>
                )}
                
                {appUser?.isPlatformAdmin && (
                     <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2"><DatabaseZap /> Data Management Tools</CardTitle>
                            <CardDescription>Advanced tools for data maintenance. Use with caution.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            {dataTools.map(tool => (
                                <ToolCard key={tool.title} {...tool} />
                            ))}
                        </CardContent>
                     </Card>
                )}
            </div>
        </RoleGuard>
    );
}
