'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/types'
import { SheetClose } from '../ui/sheet'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin', 'manager', 'cashier'] },
  { href: '/cashier', label: 'Cashier', roles: ['admin', 'manager', 'cashier'] },
  { href: '/kitchen', label: 'Kitchen', roles: ['admin', 'manager', 'kitchen'] },
  { href: '/server', label: 'Server', roles: ['admin', 'manager', 'server'] },
  { href: '/admin', label: 'Admin', roles: ['admin', 'manager'] },
]

interface MainNavProps {
  role?: UserRole | null;
  isMobile?: boolean;
}

export function MainNav({ role, isMobile = false }: MainNavProps) {
  const pathname = usePathname()

  if (!role) return null;

  const accessibleLinks = navLinks.filter(link => link.roles.includes(role))

  return (
    <nav className={cn(
      "items-center space-x-4 lg:space-x-6",
      isMobile ? "flex flex-col space-x-0 space-y-4 items-start" : "hidden md:flex"
    )}>
      {accessibleLinks.map(({ href, label }) => {
        const link = (
           <Link
              key={href}
              href={href}
              className={cn(
                'text-sm font-medium transition-colors hover:text-white/80',
                pathname?.startsWith(href) ? 'text-white' : 'text-white/70',
                isMobile && 'text-lg'
              )}
            >
              {label}
            </Link>
        );

        if (isMobile) {
          return <SheetClose key={href} asChild>{link}</SheetClose>
        }
        
        return link;
      })}
    </nav>
  )
}
