'use client';

import { useOnlineStatus } from '@/hooks/use-online-status';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WifiOff } from 'lucide-react';

export function ConnectivityBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="w-full bg-destructive text-destructive-foreground">
      <div className="container mx-auto px-4 py-1 text-xs text-center flex items-center justify-center gap-2">
        <WifiOff className="h-3 w-3"/>
        You are currently offline. Some actions may be disabled.
      </div>
    </div>
  );
}
