"use client";

import { StoreSelector } from "@/components/admin/store-selector";
import { NavButtonGroup } from "@/components/admin/nav-button-group";
import { Logo } from "@/components/admin/logo";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function CashierHeader() {
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b bg-primary px-4 md:px-6">
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
