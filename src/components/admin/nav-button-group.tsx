
'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DropdownMenuItem } from '../ui/dropdown-menu';
import { useAuthContext } from '@/context/auth-context';

const navLinks = [
  { href: '/cashier', label: 'Cashier', roles: ['admin', 'manager', 'cashier'] },
  { href: '/kitchen', label: 'Kitchen', roles: ['admin', 'manager', 'kitchen'] },
  { href: '/refill', label: 'Refill', roles: ['admin', 'manager', 'server'] },
  { href: '/admin', label: 'Admin', roles: ['admin', 'manager'] },
];

export function NavButtonGroup() {
  const pathname = usePathname();
  const { appUser } = useAuthContext();
  const userRole = appUser?.role;

  const getVariant = (href: string) => {
    return pathname.startsWith(href) ? 'secondary' : 'ghost';
  };
  
  const getClassName = (href: string) => {
    return pathname.startsWith(href)
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
  const { appUser } = useAuthContext();
  const userRole = appUser?.role;

  const allowedLinks = navLinks.filter(link => userRole && link.roles.includes(userRole));

  return (
    <>
      {allowedLinks.map(({ href, label }) => (
        <DropdownMenuItem
          key={href}
          asChild
          className={cn(pathname.startsWith(href) && 'bg-accent')}
        >
          <Link href={href}>{label}</Link>
        </DropdownMenuItem>
      ))}
    </>
  );
}
