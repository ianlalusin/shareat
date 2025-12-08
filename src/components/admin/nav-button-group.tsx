
'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { DropdownMenuItem } from '../ui/dropdown-menu';

const navLinks = [
  { href: '/cashier', label: 'Cashier' },
  { href: '/kitchen', label: 'Kitchen' },
  { href: '/refill', label: 'Refill' },
  { href: '/admin', label: 'Admin' },
];

export function NavButtonGroup() {
  const pathname = usePathname();

  const getVariant = (href: string) => {
    return pathname.startsWith(href) ? 'secondary' : 'ghost';
  };
  
  const getClassName = (href: string) => {
    return pathname.startsWith(href)
      ? 'bg-primary-foreground text-primary shadow-sm hover:bg-primary-foreground/90'
      : 'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground';
  }

  return (
    <div className="hidden md:flex items-center gap-1 rounded-lg bg-primary-foreground/10 p-1">
      {navLinks.map(({ href, label, disabled }) => (
        <Button
          key={href}
          asChild
          variant={getVariant(href)}
          size="sm"
          className={cn(getClassName(href), disabled && 'pointer-events-none opacity-50')}
        >
          <Link href={disabled ? '#' : href}>{label}</Link>
        </Button>
      ))}
    </div>
  );
}

export function NavButtonGroupMobile() {
  const pathname = usePathname();

  return (
    <>
      {navLinks.map(({ href, label, disabled }) => (
        <DropdownMenuItem
          key={href}
          asChild
          disabled={disabled}
          className={cn(pathname.startsWith(href) && 'bg-accent')}
        >
          <Link href={disabled ? '#' : href}>{label}</Link>
        </DropdownMenuItem>
      ))}
    </>
  );
}
