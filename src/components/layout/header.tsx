'use client'

import Link from 'next/link'
import { MainNav } from './main-nav'
import { UserNav } from './user-nav'
import { StoreSwitcher } from './store-switcher'
import { LocalUserNavButton } from './local-user-nav-button'
import { QrWalletNavButton } from './qr-wallet-nav-button'
import type { User } from '@/lib/types'
import { Button } from '../ui/button'
import { PanelLeft, Store } from 'lucide-react'
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import { useState } from 'react'
import { useStoreContext } from '@/context/store-context'

/**
 * App header.
 *
 * Breakpoints (audit F19):
 * - lg (1024px)+: inline nav links, store popover switcher, account.
 * - md–lg (768–1023px, tablets): nav collapses into the sheet; QR wallet,
 *   local user, store switcher and account stay in the row.
 * - below md (phones): logo, store name, local user, account, menu. The store
 *   switcher and QR wallet move into the sheet.
 * The store name is visible at every width.
 */
export default function Header({ user }: { user: User }) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const { activeStore, stores } = useStoreContext();
  // Mirrors StoreSwitcher's own "desktop" hide rule: single-store non-admins
  // get no switcher, so show the store name as plain text instead.
  const canSwitchStore = stores.length > 1 || user.role === 'admin';
  const storeName = activeStore ? (activeStore.name || '(unnamed store)') : null;

  const storeLabel = (extra?: string) =>
    storeName ? (
      <span
        className={cn('flex min-w-0 items-center gap-1.5 text-sm font-medium', extra)}
        title={storeName}
      >
        <Store className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{storeName}</span>
      </span>
    ) : null;

  return (
    <header className={cn(
      "fixed top-0 z-50 flex h-14 w-full items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6",
      "border-b bg-destructive text-destructive-foreground no-print"
    )}>
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-none lg:gap-4">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-serif text-xl font-semibold lg:mr-2">
          <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-6 w-6" />
          {/* Compact brand: text hidden on phones and at lg where the links need the room. */}
          <span className="hidden whitespace-nowrap sm:inline lg:hidden xl:inline">SHAREAT POS</span>
        </Link>
        {/* Phone: store identity stays visible even though the switcher moved into the sheet. */}
        {storeLabel('md:hidden')}
        <div className="hidden items-center gap-4 lg:flex xl:gap-6">
          <MainNav role={user.role} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 lg:gap-4">
        {/* QR wallet on tablets only: at lg+ it lives in MainNav next to Admin,
            on phones it is in the sheet. Kept in the tablet row so a cashier can
            show a customer a QR without opening the menu mid-transaction. */}
        <QrWalletNavButton
          className="hidden shrink-0 text-destructive-foreground hover:bg-white/20 hover:text-destructive-foreground md:inline-flex lg:hidden"
        />

        {/* Local-user (device profile) selector — sits before the store switcher. */}
        <LocalUserNavButton />

        <div className="relative hidden md:block">
          {canSwitchStore ? (
            // Full width while the nav is folded (md); narrower only where the nav shares the row (lg).
            <StoreSwitcher className="w-[200px] text-black lg:w-[160px] xl:w-[200px]" />
          ) : (
            storeLabel('max-w-[180px]')
          )}
        </div>

        <UserNav user={user} />

        {/* Navigation sheet trigger: everything below lg. */}
        <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
          <SheetTrigger asChild>
            <Button size="icon" variant="outline" className="shrink-0 bg-destructive text-destructive-foreground hover:bg-destructive/90 lg:hidden">
              <PanelLeft className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-full max-w-xs overflow-y-auto border-destructive-foreground/20 bg-destructive text-destructive-foreground sm:max-w-xs">
            <SheetHeader className="flex flex-row items-center gap-4 p-4">
              <SheetTitle className="sr-only">Main Menu</SheetTitle>
              <SheetClose asChild>
                <Link
                    href="/dashboard"
                    className="group flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground md:text-base"
                    >
                    <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-5 w-5 transition-all group-hover:scale-110" />
                    <span className="sr-only">SharEat Hub </span>
                </Link>
              </SheetClose>
            </SheetHeader>
            {/* Phone: the store switcher moved here from the header row. */}
            {canSwitchStore && (
              <div className="px-4 pb-2 md:hidden">
                <StoreSwitcher variant="mobileSheet" onSelected={() => setIsMobileSheetOpen(false)} />
              </div>
            )}
            <nav className="grid gap-6 p-4 text-lg font-medium">
              <MainNav role={user.role} isMobile={true} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
