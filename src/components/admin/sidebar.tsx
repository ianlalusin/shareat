
"use client";

import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Logo } from "./logo";
import {
  Store,
  Users,
  BookMarked,
  Boxes,
  AreaChart,
  Wrench,
  Settings,
  CircleUser,
  LayoutDashboard,
  ListChecks,
  LayoutGrid,
  Warehouse,
  Receipt,
  MailCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";

const menuItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/store", label: "Store", icon: Store },
  { href: "/admin/staff", label: "Staff", icon: Users },
  { href: "/admin/pending-accounts", label: "Pending Accounts", icon: MailCheck },
  { href: "/admin/table-management", label: "Table Management", icon: LayoutGrid },
  { href: "/admin/products", label: "Products", icon: Boxes },
  { href: "/admin/inventory", label: "Inventory", icon: Warehouse },
  { href: "/admin/menu", label: "Menu", icon: BookMarked },
  { href: "/admin/reports/sales", label: "Sales Report", icon: AreaChart },
  { href: "/admin/global-collections", label: "Global Collections", icon: ListChecks },
  { href: "#maintenance", label: "Maintenance", icon: Wrench },
];

const bottomMenuItems = [
  { href: "/admin/settings", label: "Settings", icon: Settings, roles: ["manager", "admin", "owner"] },
  { href: "/admin/settings/account", label: "Account", icon: CircleUser, roles: [] },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { appUser, devMode } = useAuthContext();
  
  const hasAccess = (roles: string[]) => {
    if (devMode || roles.length === 0) return true;
    return appUser && roles.includes(appUser.role);
  };

  const isActive = (href: string) => {
    if (href.startsWith('#')) return false;
    // Exact match for the main admin/dashboard page
    if (href === "/admin") {
      return pathname === href;
    }
    // StartsWith for all other nested pages
    return pathname.startsWith(href);
  }

  return (
    <>
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <Logo className="h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold font-headline text-foreground group-data-[state=collapsed]:hidden">
            <span>Shar</span>
            <span className="text-primary">Eat Hub</span>
          </h1>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton asChild isActive={isActive(item.href)}>
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {bottomMenuItems.map((item) => (
            hasAccess(item.roles) && (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton asChild isActive={isActive(item.href)}>
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          ))}
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
