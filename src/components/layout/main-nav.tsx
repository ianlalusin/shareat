'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase/client'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/types'
import { SheetClose } from '../ui/sheet'
import { Badge } from '../ui/badge'
import { useStoreContext } from '@/context/store-context'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin', 'manager', 'cashier'] },
  { href: '/cashier', label: 'Cashier', roles: ['admin', 'manager', 'cashier'] },
  { href: '/reservations', label: 'Reservations', roles: ['admin', 'manager', 'cashier'] },
  { href: '/pins', label: 'PINs', roles: ['admin', 'manager', 'cashier'] },
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
  const { activeStoreId } = useStoreContext()

  const accessibleLinks = role ? navLinks.filter(link => link.roles.includes(role)) : []
  const showReservations = accessibleLinks.some(link => link.href === '/reservations')

  // Live count of PENDING bookings (status "booked" — not yet confirmed,
  // cancelled/rejected, handled, etc.) across all upcoming dates, so future
  // website bookings aren't missed. Single-field query (no composite index);
  // upcoming filtering is done client-side. Drives the 3-color blink alert.
  const [pendingReservationCount, setPendingReservationCount] = useState(0)
  useEffect(() => {
    if (!showReservations || !activeStoreId) {
      setPendingReservationCount(0)
      return
    }
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const startMs = startOfToday.getTime()
    const q = query(
      collection(db, 'stores', activeStoreId, 'reservations'),
      where('status', '==', 'booked'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const pending = snap.docs.filter(d => Number((d.data() as any).reservedForMs ?? 0) >= startMs).length
        setPendingReservationCount(pending)
      },
      () => setPendingReservationCount(0),
    )
    return () => unsub()
  }, [showReservations, activeStoreId])

  if (!role) return null;

  return (
    <nav className={cn(
      "items-center space-x-4 lg:space-x-6",
      isMobile ? "flex flex-col space-x-0 space-y-4 items-start" : "hidden md:flex"
    )}>
      {accessibleLinks.map(({ href, label }) => {
        const hasPending = href === '/reservations' && pendingReservationCount > 0
        const link = (
           <Link
              key={href}
              href={href}
              className={cn(
                'text-sm font-medium transition-colors hover:text-white/80 inline-flex items-center gap-1.5',
                pathname?.startsWith(href) ? 'text-white' : 'text-white/70',
                isMobile && 'text-lg',
                hasPending && 'reservation-alert-blink'
              )}
              title={hasPending ? `${pendingReservationCount} pending reservation${pendingReservationCount > 1 ? 's' : ''} awaiting confirmation` : undefined}
            >
              {label}
              {hasPending && (
                <Badge
                  className="h-5 min-w-5 justify-center px-1.5 text-xs bg-white text-primary hover:bg-white"
                >
                  {pendingReservationCount}
                </Badge>
              )}
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
