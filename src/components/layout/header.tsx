
'use client'

import Link from 'next/link'
import { MainNav } from './main-nav'
import { UserNav } from './user-nav'
import { StoreSwitcher } from './store-switcher'
import type { User } from '@/lib/types'
import { Button } from '../ui/button'
import { PanelLeft } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { useState } from 'react'

export default function Header({ user }: { user: User }) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  return (
    <header className={cn(
      "fixed top-0 z-50 flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6",
      "border-b bg-destructive text-destructive-foreground"
    )}>
      <div className="flex flex-shrink min-w-0 items-center gap-4">
        <Link href="/dashboard" className="mr-4 flex shrink-0 items-center gap-2 font-serif text-xl font-semibold">
          <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-6 w-6" />
          <span className="hidden sm:inline-block">SharEat App</span>
        </Link>
        <div className="hidden items-center gap-4 md:flex lg:gap-6">
          <MainNav role={user.role} />
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <div className="relative hidden flex-1 md:block md:grow-0">
          <StoreSwitcher />
        </div>
        <UserNav user={user} />
        
        {/* Mobile Navigation Trigger */}
        <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button size="icon" variant="outline" className="shrink-0 bg-destructive text-destructive-foreground hover:bg-destructive/90 md:hidden">
              <PanelLeft className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-full max-w-xs border-destructive-foreground/20 bg-destructive text-destructive-foreground sm:max-w-xs">
            <SheetHeader className="flex flex-row items-center gap-4 p-4">
              <SheetClose asChild>
                <Link
                    href="/dashboard"
                    className="group flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground md:text-base"
                    >
                    <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-5 w-5 transition-all group-hover:scale-110" />
                    <span className="sr-only">SharEat Hub</span>
                </Link>
              </SheetClose>
               <SheetTitle className="text-white">SharEat Hub</SheetTitle>
            </SheetHeader>
            <div className="border-y border-white/20 p-4">
                <StoreSwitcher variant="mobileSheet" onSelected={() => setIsMobileSheetOpen(false)} />
            </div>
            <nav className="grid gap-6 p-4 text-lg font-medium">
              <MainNav role={user.role} isMobile={true} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
