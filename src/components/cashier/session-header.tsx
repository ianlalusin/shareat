
"use client";

import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface SessionHeaderProps {
  session: {
    id: string;
    tableNumber?: string | null;
    guestCount: number;
    packageName: string;
    sessionMode?: 'package_dinein' | 'alacarte';
    customerName?: string | null;
    sessionLabel?: string;
    linkedCustomerName?: string | null;
  };
}

export function SessionHeader({ session }: SessionHeaderProps) {

  const isAlaCarte = session.sessionMode === 'alacarte';
  const title = session.sessionLabel
    ?? (isAlaCarte ? (session.customerName || 'Ala Carte') : `Table ${session.tableNumber}`);
  const subtitle = isAlaCarte ? "Ala Carte" : session.packageName;

  return (
    <div className="grid gap-1">
      <h1 className="text-2xl sm:text-3xl font-bold leading-none">{title}</h1>
      <div className="flex items-center gap-4 flex-wrap">
        <p className="text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex items-center gap-2 flex-wrap">
            {!isAlaCarte && <Badge variant="outline">{session.guestCount} Guests</Badge>}
            <Badge variant="secondary">ID: {session.id.substring(0, 6)}</Badge>
            {session.linkedCustomerName && (
              <Badge variant="outline" className="bg-primary/10 border-primary/30 text-primary gap-1">
                <Sparkles className="h-3 w-3" /> Sharelebrator: {session.linkedCustomerName}
              </Badge>
            )}
        </div>
      </div>
    </div>
  );
}

    

    
