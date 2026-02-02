
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useAuthContext } from '@/context/auth-context';
import { useStoreContext } from '@/context/store-context';
import { useToast } from '@/hooks/use-toast';
import { collection, query, where, getDocs, writeBatch, doc, serverTimestamp, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { RoleGuard } from '../guards/RoleGuard';
import type { KitchenTicket, RtKdsStationDoc } from '@/lib/types';
import { stripUndefined } from '@/lib/firebase/utils';

export function SyncKdsTicketsTool() {
  const { appUser } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSync = async () => {
    if (!activeStore) {
      toast({ variant: 'destructive', title: 'No store selected' });
      return;
    }
    setIsSyncing(true);
    toast({ title: 'KDS Sync started...', description: 'Fetching all active kitchen tickets.' });

    try {
      // 1. Get all active kitchen tickets using a collectionGroup query
      const ticketsRef = collectionGroup(db, 'kitchentickets');
      const q = query(
        ticketsRef,
        where('storeId', '==', activeStore.id),
        where('status', 'in', ['preparing', 'ready'])
      );
      const activeTicketsSnap = await getDocs(q);
      const activeTickets = activeTicketsSnap.docs.map(d => d.data() as KitchenTicket);

      // 2. Group tickets by kitchenLocationId
      const ticketsByStation = activeTickets.reduce((acc, ticket) => {
        const stationId = ticket.kitchenLocationId;
        if (stationId) {
          if (!acc[stationId]) {
            acc[stationId] = [];
          }
          acc[stationId].push(ticket);
        }
        return acc;
      }, {} as Record<string, KitchenTicket[]>);

      // 3. Get all current projection docs to delete them
      const projectionsRef = collection(db, 'stores', activeStore.id, 'rtKdsTickets');
      const projectionsSnap = await getDocs(projectionsRef);

      const batch = writeBatch(db);
      let deletedCount = 0;
      let stationCount = 0;

      // 4. Delete all existing projection documents
      projectionsSnap.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
      });

      // 5. Re-create projections from the source-of-truth tickets
      for (const stationId in ticketsByStation) {
        const stationTickets = ticketsByStation[stationId];
        stationCount++;

        // Sort tickets by creation time for ordered display
        stationTickets.sort((a, b) => (a.createdAtClientMs || 0) - (b.createdAtClientMs || 0));
        
        const newProjectionDocRef = doc(projectionsRef, stationId);

        const ticketsMap = stationTickets.reduce((acc, ticket) => {
            acc[ticket.id] = stripUndefined(ticket); // Ensure ticket data is clean
            return acc;
        }, {} as Record<string, KitchenTicket>);

        const sessionIndex = stationTickets.reduce((acc, ticket) => {
            if(!acc[ticket.sessionId]) {
                acc[ticket.sessionId] = [];
            }
            if(!acc[ticket.sessionId].includes(ticket.id)){
                 acc[ticket.sessionId].push(ticket.id);
            }
            return acc;
        }, {} as Record<string, string[]>);

        const newProjection: RtKdsStationDoc = {
            meta: {
                source: 'manual_sync_tool',
                updatedAt: serverTimestamp() as any, // Cast because we can't get real value on client
            },
            kitchenLocationId: stationId,
            activeIds: stationTickets.map(t => t.id),
            tickets: ticketsMap,
            sessionIndex: sessionIndex,
        };
        batch.set(newProjectionDocRef, newProjection);
      }

      await batch.commit();

      toast({
        title: 'KDS Sync Complete',
        description: `Synced ${activeTickets.length} tickets across ${stationCount} stations. ${deletedCount} old projections removed.`,
      });
    } catch (error: any) {
      console.error('KDS sync failed:', error);
      toast({
        variant: 'destructive',
        title: 'Sync Failed',
        description: error.message,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <RoleGuard allow={['admin', 'manager']}>
      <Button variant="outline" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        Sync KDS Tickets
      </Button>
    </RoleGuard>
  );
}
