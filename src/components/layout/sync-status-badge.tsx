'use client';

import { useOnlineStatus } from '@/hooks/use-online-status';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { cn } from '@/lib/utils';

export function SyncStatusBadge() {
  const online = useOnlineStatus();
  const { hasPendingWrites } = useSyncStatus();

  // Simple text + color logic
  let label = 'All changes saved';
  let className = 'bg-emerald-500 text-white';

  if (!online) {
    label = 'Offline – changes will sync later';
    className = 'bg-red-500 text-white';
  } else if (hasPendingWrites) {
    label = 'Syncing changes...';
    className = 'bg-amber-500 text-black';
  }

  return (
    <div className="flex justify-end px-2 pb-2">
      <span
        className={cn(
          'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium shadow-sm',
          className
        )}
      >
        {label}
      </span>
    </div>
  );
}
