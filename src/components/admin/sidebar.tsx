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
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const menuItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/store", label: "Store", icon: Store },
  { href: "/admin/staff", label: "Staff", icon: Users },
  { href: "/admin/table-management", label: "Table Management", icon: LayoutGrid },
  { href: "/admin/menu", label: "Menu", icon: BookMarked },
  { href: "#inventory", label: "Inventory", icon: Boxes },
  { href: "#reports", label: "Reports", icon: AreaChart },
  { href: "/admin/g-list", label: "G.List", icon: ListChecks },
  { href: "#maintenance", label: "Maintenance", icon: Wrench },
];

const bottomMenuItems = [
  { href: "#settings", label: "Settings", icon: Settings },
  { href: "#account", label: "Account", icon: CircleUser },
];

export function AdminSidebar() {
  const pathname = usePathname();
  
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
            SharEat Hub
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
