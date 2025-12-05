"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { StoreSelector } from "./store-selector";
import { NavButtonGroup } from "./nav-button-group";
import { Logo } from "./logo";

export function AdminHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b bg-primary px-4 md:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-primary-foreground hover:bg-primary-foreground/10" />
        <div className="flex items-center gap-2 group-data-[sidebar-hidden=true]:hidden">
          <Logo className="h-8 w-8 text-primary-foreground" />
          <h1 className="text-lg font-semibold font-headline text-primary-foreground">
            SharEat Hub
          </h1>
        </div>
      </div>

      <div className="flex w-full items-center justify-end gap-4 md:gap-2 lg:gap-4">
        <StoreSelector />
        <NavButtonGroup />
      </div>
    </header>
  );
}
