
"use client";

import { Badge } from "@/components/ui/badge";

interface SessionHeaderProps {
  session: {
    id: string;
    tableNumber: string;
    guestCount: number;
    packageName: string;
    sessionMode?: 'package_dinein' | 'alacarte';
    customer?: { name?: string | null };
  };
}

export function SessionHeader({ session }: SessionHeaderProps) {
  
  const isAlaCarte = session.sessionMode === 'alacarte';
  const title = isAlaCarte ? session.customer?.name : `Table ${session.tableNumber}`;
  const subtitle = isAlaCarte ? "Ala Carte" : session.packageName;

  return (
    <div className="grid gap-1">
      <h1 className="text-2xl sm:text-3xl font-bold leading-none">{title}</h1>
      <div className="flex items-center gap-4">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex items-center gap-2">
            {!isAlaCarte && <Badge variant="outline">{session.guestCount} Guests</Badge>}
            <Badge variant="secondary">ID: {session.id.substring(0, 6)}</Badge>
        </div>
      </div>
    </div>
  );
}

    