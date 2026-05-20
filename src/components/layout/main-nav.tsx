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
import { getDayIdFromTimestamp } from '@/lib/analytics/daily'

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', roles: ['admin', 'manager', 'cashier'] },
  { href: '/cashier', label: 'Cashier', roles: ['admin', 'manager', 'cashier'] },
  { href: '/reservations', label: 'Reservations', roles: ['admin', 'manager', 'cashier'] },
  { href: '/pins', label: 'PINs', roles: ['admin', 'manager', 'cashier'] },
  { href: '/kitchen', label: 'Kitchen', roles: ['admin', 'manager', 'kitchen'] },
  { href: '/server', label: 'Server', roles: ['admin', 'manager', 'server'] },
  { href: '/admin', label: 'Admin', roles: ['admin', 'manager'] },
]

const OPEN_RESERVATION_STATUSES = ['booked', 'confirmed']

interface MainNavProps {
  role?: UserRole | null;
  isMobile?: boolean;
}

export function MainNav({ role, isMobile = false }: MainNavProps) {
  const pathname = usePathname()
  const { activeStoreId } = useStoreContext()

  const accessibleLinks = role ? navLinks.filter(link => link.roles.includes(role)) : []
  const showReservations = accessibleLinks.some(link => link.href === '/reservations')

  // Live count of today's open (booked/confirmed) reservations for the badge.
  // Only subscribes when the Reservations link is visible and a store is active.
  const [todayReservationCount, setTodayReservationCount] = useState(0)
  useEffect(() => {
    if (!showReservations || !activeStoreId) {
      setTodayReservationCount(0)
      return
    }
    const dayId = getDayIdFromTimestamp(new Date())
    const q = query(
      collection(db, 'stores', activeStoreId, 'reservations'),
      where('reservedForDayId', '==', dayId),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const open = snap.docs.filter(d => OPEN_RESERVATION_STATUSES.includes((d.data() as any).status)).length
        setTodayReservationCount(open)
      },
      () => setTodayReservationCount(0),
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
        const showBadge = href === '/reservations' && todayReservationCount > 0
        const link = (
           <Link
              key={href}
              href={href}
              className={cn(
                'text-sm font-medium transition-colors hover:text-white/80 inline-flex items-center gap-1.5',
                pathname?.startsWith(href) ? 'text-white' : 'text-white/70',
                isMobile && 'text-lg'
              )}
            >
              {label}
              {showBadge && (
                <Badge
                  className="h-5 min-w-5 justify-center px-1.5 text-xs bg-white text-primary hover:bg-white"
                  title={`${todayReservationCount} reservation${todayReservationCount > 1 ? 's' : ''} today`}
                >
                  {todayReservationCount}
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
