
"use client";

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { StoreSelector } from "./store-selector";
import { NavButtonGroup, NavButtonGroupMobile } from "./nav-button-group";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function AdminHeader() {
  const { state } = useSidebar();

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b bg-primary px-4 md:px-6">
      <div className="flex items-center gap-2">
        <SidebarTrigger className="text-primary-foreground hover:bg-primary-foreground/10" />
        <div
          className={cn(
            "hidden items-center gap-2 md:flex",
            state === "expanded" && "md:hidden"
          )}
        >
          <Logo className="h-8 w-8 text-primary-foreground" />
          <h1 className="text-lg font-semibold font-headline text-primary-foreground whitespace-nowrap">
            SharEat Hub
          </h1>
        </div>
      </div>

      <div className="flex w-full items-center justify-end gap-4 md:gap-2 lg:gap-4">
        <StoreSelector />
        <NavButtonGroup />
        
        {/* Mobile-only menu */}
        <div className="md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/10"
              >
                <MoreVertical className="h-6 w-6" />
                <span className="sr-only">More options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <NavButtonGroupMobile />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
