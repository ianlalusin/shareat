
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
  List,
  GitBranch,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthContext } from "@/context/auth-context";
import { StaffRole } from "@/lib/types";

const menuItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, roles: ['admin', 'manager'] },
  { href: "/admin/store", label: "Store", icon: Store, roles: ['admin'] },
  { href: "/admin/staff", label: "Staff", icon: Users, roles: ['admin', 'manager'] },
  { href: "/admin/pending-accounts", label: "Pending Accounts", icon: MailCheck, roles: ['admin', 'manager'] },
  { href: "/admin/table-management", label: "Table Management", icon: LayoutGrid, roles: ['admin', 'manager'] },
  { href: "/admin/products", label: "Products", icon: Boxes, roles: ['admin', 'manager'] },
  { href: "/admin/inventory", label: "Inventory", icon: Warehouse, roles: ['admin', 'manager'] },
  { href: "/admin/menu", label: "Menu", icon: BookMarked, roles: ['admin', 'manager'] },
  { href: "/admin/reports/sales", label: "Sales Report", icon: AreaChart, roles: ['admin', 'manager'] },
  { href: "/admin/collections", label: "Collections", icon: ListChecks, roles: ['admin', 'manager'] },
  { href: "/admin/migrations/store-scope", label: "Migrations", icon: GitBranch, roles: ['admin'] },
  { href: "#maintenance", label: "Maintenance", icon: Wrench, roles: ['admin'] },
];

const bottomMenuItems = [
  { href: "/admin/settings", label: "Settings", icon: Settings, roles: ['admin', 'manager'] },
  { href: "/admin/settings/account", label: "Account", icon: CircleUser, roles: ['admin', 'manager', 'cashier', 'server', 'kitchen'] },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { appUser } = useAuthContext();
  const userRole = appUser?.role;

  const isActive = (href: string) => {
    if (href.startsWith('#')) return false;
    // Exact match for the main admin/dashboard page
    if (href === "/admin") {
      return pathname === href;
    }
    // StartsWith for all other nested pages
    return pathname.startsWith(href);
  }

  const filterLinks = (links: typeof menuItems) => {
      if (!userRole) return [];
      return links.filter(link => link.roles.includes(userRole));
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
          {filterLinks(menuItems).map((item) => (
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
          {filterLinks(bottomMenuItems).map((item) => (
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
      </SidebarFooter>
    </>
  );
}
