
import Link from 'next/link'
import { Logo } from '@/components/icons'
import { MainNav } from './main-nav'
import { UserNav } from './user-nav'
import { StoreSwitcher } from './store-switcher'
import type { User } from '@/lib/types'
import { Button } from '../ui/button'
import { PanelLeft } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet'
import { cn } from '@/lib/utils'
import Image from 'next/image'

export default function Header({ user }: { user: User }) {
  return (
    <header className={cn(
      "fixed top-0 z-30 flex h-14 w-full items-center gap-4 px-4 sm:px-6",
      "border-b bg-destructive text-destructive-foreground"
    )}>
      <Link href="/dashboard" className="flex items-center gap-2 font-serif text-xl font-semibold mr-4">
        <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-6 w-6" />
        <span className="hidden sm:inline-block">SharEat Hub</span>
      </Link>
      
      <div className="hidden md:flex md:items-center md:gap-4 lg:gap-6">
        <MainNav role={user.role} />
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-4">
        <div className="relative flex-1 md:grow-0">
          <StoreSwitcher />
        </div>
        <UserNav user={user} />
        
        {/* Mobile Navigation Trigger */}
        <Sheet>
          <SheetTrigger asChild>
            <Button size="icon" variant="outline" className="md:hidden bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              <PanelLeft className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="sm:max-w-xs bg-destructive text-destructive-foreground border-destructive-foreground/20">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation Menu</SheetTitle>
            </SheetHeader>
            <nav className="grid gap-6 text-lg font-medium mt-8">
               <Link
                  href="/dashboard"
                  className="group flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground md:text-base"
                  >
                  <Image src="/logo.png" alt="SharEat Hub Logo" width={24} height={24} className="h-5 w-5 transition-all group-hover:scale-110" />
                  <span className="sr-only">SharEat Hub</span>
              </Link>
              <MainNav role={user.role} isMobile={true} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  )
}
