
"use client";

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserCog, Package, Store, Globe, Archive, UtensilsCrossed, Sparkles, Box, SlidersHorizontal, ClipboardList, LineChart, Wallet } from "lucide-react";
import { AppUser, useAuthContext } from "@/context/auth-context";
import { RoleGuard } from "@/components/guards/RoleGuard";

const adminTools = [
    { title: "User Management", description: "Manage roles, permissions, and verify accounts.", href: "/admin/users", icon: UserCog },
    { title: "Store Management", description: "Create, edit, or deactivate store locations.", href: "/admin/stores", icon: Store },
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
    { title: "Sales Reports", description: "Analyze sales data and trends.", href: "/manager/reports", icon: LineChart },
]


export default function AdminPage() {
    const { appUser } = useAuthContext();

    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Admin & Manager Hub" description="Global configurations and store-level operations." />
            <div className="grid gap-6">
                {appUser?.role === 'admin' && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>Global Settings</CardTitle>
                                <CardDescription>Access tools for global system configuration.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2">
                                {adminTools.map(tool => (
                                    <Link href={tool.href} key={tool.title}>
                                        <Card className="h-full hover:bg-muted/50 transition-colors">
                                            <CardHeader>
                                                <div className="flex items-center gap-4">
                                                    <tool.icon className="h-6 w-6 text-muted-foreground" />
                                                    <div>
                                                        <CardTitle>{tool.title}</CardTitle>
                                                        <CardDescription>{tool.description}</CardDescription>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                        </Card>
                                    </Link>
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
                                    <Link href={tool.href} key={tool.title}>
                                        <Card className="h-full hover:bg-muted/50 transition-colors">
                                            <CardHeader>
                                                <div className="flex items-center gap-4">
                                                    <tool.icon className="h-6 w-6 text-muted-foreground" />
                                                    <div>
                                                        <CardTitle>{tool.title}</CardTitle>
                                                        <CardDescription>{tool.description}</CardDescription>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                        </Card>
                                    </Link>
                                ))}
                            </CardContent>
                        </Card>
                    </>
                )}

                {(appUser?.role === 'admin' || appUser?.role === 'manager') && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>Manager Tools</CardTitle>
                                <CardDescription>Oversee and manage your store's operations, settings, and collections.</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {managerTools.map(tool => (
                                    <Link href={tool.href} key={tool.title}>
                                        <Card className="h-full hover:bg-muted/50 transition-colors">
                                            <CardHeader>
                                                <div className="flex items-center gap-4">
                                                    {tool.icon && <tool.icon className="h-6 w-6 text-muted-foreground" />}
                                                    <div>
                                                        <CardTitle>{tool.title}</CardTitle>
                                                        <CardDescription>{tool.description}</CardDescription>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                        </Card>
                                    </Link>
                                ))}
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>
        </RoleGuard>
    );
}
