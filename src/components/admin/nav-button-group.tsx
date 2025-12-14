
'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DropdownMenuItem } from '../ui/dropdown-menu';
import { useAuthContext } from '@/context/auth-context';
import { StaffRole } from '@/lib/types';

const navLinks: { href: string; label: string; roles: StaffRole[] }[] = [
  { href: '/cashier', label: 'Cashier', roles: ['admin', 'manager', 'cashier'] },
  { href: '/kitchen', label: 'Kitchen', roles: ['admin', 'manager', 'kitchen'] },
  { href: '/refill', label: 'Refill', roles: ['admin', 'manager', 'server'] },
  { href: '/admin', label: 'Admin', roles: ['admin', 'manager'] },
];

export function NavButtonGroup() {
  const pathname = usePathname();
  const { appUser, devMode } = useAuthContext();
  const userRole = devMode ? 'admin' : appUser?.role;

  const getVariant = (href: string) => {
    // Make it active if it's the dashboard or a sub-page
    if (href === '/admin' && pathname.startsWith('/admin')) {
      return 'secondary';
    }
    return pathname.startsWith(href) ? 'secondary' : 'ghost';
  };
  
  const getClassName = (href: string) => {
    const isActive = (href === '/admin' && pathname.startsWith('/admin')) || (href !== '/admin' && pathname.startsWith(href));
    return isActive
      ? 'bg-primary-foreground text-primary shadow-sm hover:bg-primary-foreground/90'
      : 'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground';
  }

  const allowedLinks = navLinks.filter(link => userRole && link.roles.includes(userRole));

  return (
    <div className="hidden md:flex items-center gap-1 rounded-lg bg-primary-foreground/10 p-1">
      {allowedLinks.map(({ href, label }) => (
        <Button
          key={href}
          asChild
          variant={getVariant(href)}
          size="sm"
          className={cn(getClassName(href))}
        >
          <Link href={href}>{label}</Link>
        </Button>
      ))}
    </div>
  );
}

export function NavButtonGroupMobile() {
  const pathname = usePathname();
  const { appUser, devMode } = useAuthContext();
  const userRole = devMode ? 'admin' : appUser?.role;

  const allowedLinks = navLinks.filter(link => userRole && link.roles.includes(userRole));

  const isActive = (href: string) => {
    if (href === '/admin' && pathname.startsWith('/admin')) {
        return true;
    }
    return href !== '/admin' && pathname.startsWith(href);
  }

  return (
    <>
      {allowedLinks.map(({ href, label }) => (
        <DropdownMenuItem
          key={href}
          asChild
          className={cn(isActive(href) && 'bg-accent')}
        >
          <Link href={href}>{label}</Link>
        </DropdownMenuItem>
      ))}
    </>
  );
}
