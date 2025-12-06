"use client";

import { StoreSelector } from "@/components/admin/store-selector";
import { NavButtonGroup } from "@/components/admin/nav-button-group";
import { Logo } from "@/components/admin/logo";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { CircleUser } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from "../ui/button";

export function CashierHeader() {
  // TODO: Replace with actual user data
  const userName = "Jane Doe";

  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-primary px-4 md:px-6">
      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full text-primary-foreground hover:bg-primary-foreground/10">
              <CircleUser className="h-6 w-6" />
              <span className="sr-only">Toggle user menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Support</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Logout</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="text-sm font-medium text-primary-foreground">
            <div className="text-xs">Logged in as</div>
            <div>{userName}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
         <Link href="/admin" className="flex items-center gap-2">
            <Logo className="h-8 w-8 text-primary-foreground" />
            <h1 className="hidden md:block text-lg font-semibold font-headline text-primary-foreground whitespace-nowrap">
                SharEat Hub
            </h1>
         </Link>
      </div>

      <div className="flex w-full items-center justify-end gap-4 md:gap-2 lg:gap-4">
        <StoreSelector />
        <NavButtonGroup />
      </div>
    </header>
  );
}
