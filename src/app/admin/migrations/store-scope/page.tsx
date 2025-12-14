
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useFirestore, useAuth } from '@/firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { RoleGate } from '@/components/auth/role-gate';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Store, Staff, AppUser } from '@/lib/types';
import { toast } from '@/hooks/use-toast';
import { saveAs } from 'file-saver';

type MigrationStatus = 'READY' | 'SKIP' | 'UNRESOLVED' | 'ERROR';

type MigrationProposal = {
  type: 'Staff' | 'User';
  docId: string;
  name: string;
  legacyFields: Record<string, any>;
  proposedChanges: Record<string, any>;
  status: MigrationStatus;
  details: string;
};

const normalizeStoreName = (name: string) => {
    if (!name) return '';
    return name.toLowerCase().trim().replace(/\s+/g, ' ');
};

function StoreScopeMigrationPage() {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  const [stores, setStores] = useState<Store[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  
  const [proposals, setProposals] = useState<MigrationProposal[]>([]);
  
  const firestore = useFirestore();

  useEffect(() => {
    const fetchData = async () => {
      if (!firestore) return;
      setLoading(true);
      try {
        const [storesSnap, staffSnap, usersSnap] = await Promise.all([
          getDocs(collection(firestore, 'stores')),
          getDocs(collection(firestore, 'staff')),
          getDocs(collection(firestore, 'users')),
        ]);
        setStores(storesSnap.docs.map(d => ({ id: d.id, ...d.data() } as Store)));
        setStaff(staffSnap.docs.map(d => ({ id: d.id, ...d.data() } as Staff)));
        setUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as AppUser)));
      } catch (error) {
        toast({ variant: 'destructive', title: 'Error fetching data', description: 'Could not load initial data for migration.' });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [firestore]);

  const storeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    stores.forEach(s => map.set(normalizeStoreName(s.storeName), s.id));
    return map;
  }, [stores]);
  
  const staffMap = useMemo(() => {
    const map = new Map<string, Staff>();
    staff.forEach(s => map.set(s.id, s));
    return map;
  }, [staff]);

  const handlePreview = useCallback(() => {
    setProcessing(true);
    const newProposals: MigrationProposal[] = [];

    // Process Staff
    for (const s of staff) {
        const needsMigration = !s.storeIds || s.storeIds.length === 0 || !s.defaultStoreId;
        if (!needsMigration) {
            newProposals.push({ type: 'Staff', docId: s.id, name: s.fullName, legacyFields: { assignedStore: s.assignedStore }, proposedChanges: {}, status: 'SKIP', details: 'Already has storeIds.' });
            continue;
        }

        let resolvedStoreIds: string[] = [];
        let details = '';

        if (s.assignedStore) {
            const normalizedName = normalizeStoreName(s.assignedStore);
            const foundId = storeNameMap.get(normalizedName);
            if (foundId) {
                resolvedStoreIds = [foundId];
                details = `Matched '${s.assignedStore}' to store ID.`;
            } else {
                newProposals.push({ type: 'Staff', docId: s.id, name: s.fullName, legacyFields: { assignedStore: s.assignedStore }, proposedChanges: {}, status: 'UNRESOLVED', details: `Store name '${s.assignedStore}' not found.` });
                continue;
            }
        } else {
             newProposals.push({ type: 'Staff', docId: s.id, name: s.fullName, legacyFields: { assignedStore: 'N/A' }, proposedChanges: {}, status: 'UNRESOLVED', details: 'No assignedStore field to migrate from.' });
             continue;
        }
        
        const changes: Record<string, any> = { storeIds: resolvedStoreIds, defaultStoreId: resolvedStoreIds[0] || null };
        newProposals.push({ type: 'Staff', docId: s.id, name: s.fullName, legacyFields: { assignedStore: s.assignedStore }, proposedChanges: changes, status: 'READY', details });
    }

    // Process Users
    for (const u of users) {
        const needsMigration = !u.storeIds || u.storeIds.length === 0 || !u.activeStoreId;
        if (!needsMigration) {
            newProposals.push({ type: 'User', docId: u.id, name: u.displayName, legacyFields: { storeId: u.storeId }, proposedChanges: {}, status: 'SKIP', details: 'Already has multi-store fields.' });
            continue;
        }
        
        let proposedStoreIds: string[] = [];
        let proposedDefaultStoreId: string | null = null;
        let details = '';

        const linkedStaff = u.staffId ? staffMap.get(u.staffId) : null;
        if (linkedStaff) {
             const staffProposal = newProposals.find(p => p.type === 'Staff' && p.docId === u.staffId);
             if (staffProposal && staffProposal.status === 'READY') {
                proposedStoreIds = staffProposal.proposedChanges.storeIds;
                proposedDefaultStoreId = staffProposal.proposedChanges.defaultStoreId;
                details = 'Using proposed staff migration data.';
             } else if (linkedStaff.storeIds && linkedStaff.storeIds.length > 0) {
                 proposedStoreIds = linkedStaff.storeIds;
                 proposedDefaultStoreId = linkedStaff.defaultStoreId || linkedStaff.storeIds[0];
                 details = 'Using existing staff multi-store data.';
             } else if (linkedStaff.assignedStore) {
                const foundId = storeNameMap.get(normalizeStoreName(linkedStaff.assignedStore));
                if (foundId) {
                    proposedStoreIds = [foundId];
                    proposedDefaultStoreId = foundId;
                    details = 'Resolved from linked staff assignedStore.';
                }
            }
        }
        
        if (proposedStoreIds.length === 0) {
            newProposals.push({ type: 'User', docId: u.id, name: u.displayName, legacyFields: { staffId: u.staffId, storeId: u.storeId }, proposedChanges: {}, status: 'UNRESOLVED', details: 'Could not resolve any store IDs for this user.' });
            continue;
        }
        
        const proposedActiveStoreId = (u.activeStoreId && proposedStoreIds.includes(u.activeStoreId)) ? u.activeStoreId : proposedDefaultStoreId;
        
        const changes: Record<string, any> = {
            storeIds: proposedStoreIds,
            activeStoreId: proposedActiveStoreId,
            storeId: proposedActiveStoreId, // for legacy compat
        };
        newProposals.push({ type: 'User', docId: u.id, name: u.displayName, legacyFields: { storeId: u.storeId }, proposedChanges: changes, status: 'READY', details });
    }

    setProposals(newProposals.sort((a, b) => a.status.localeCompare(b.status)));
    setProcessing(false);
    toast({ title: 'Preview Generated', description: `Found ${newProposals.filter(p => p.status === 'READY').length} items ready for migration.` });
  }, [staff, users, storeNameMap, staffMap]);

  const handleApplyChanges = async () => {
    const readyProposals = proposals.filter(p => p.status === 'READY');
    if (readyProposals.length === 0) {
      toast({ title: 'No changes to apply.' });
      return;
    }
    
    if (!window.confirm(`Are you sure you want to apply changes to ${readyProposals.length} documents? This action is irreversible.`)) {
      return;
    }

    setProcessing(true);
    let successCount = 0;
    const errors: string[] = [];
    
    // Batching in chunks of 400
    for (let i = 0; i < readyProposals.length; i += 400) {
      const batch = writeBatch(firestore);
      const chunk = readyProposals.slice(i, i + 400);

      chunk.forEach(p => {
        const collectionName = p.type === 'Staff' ? 'staff' : 'users';
        const docRef = doc(firestore, collectionName, p.docId);
        batch.update(docRef, p.proposedChanges);
      });
      
      try {
        await batch.commit();
        successCount += chunk.length;
      } catch (e) {
        console.error(e);
        errors.push(`Batch ${i / 400 + 1} failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
    
    setProcessing(false);
    if (errors.length > 0) {
      toast({ variant: 'destructive', title: 'Migration Partially Failed', description: `${errors.length} batches failed to apply. See console.` });
    } else {
      toast({ title: 'Migration Complete!', description: `${successCount} documents were successfully updated.` });
    }
    setProposals([]); // Clear proposals to force a new preview
  };

  const handleExport = () => {
    if (proposals.length === 0) {
      toast({ title: 'Nothing to export', description: 'Please generate a preview first.' });
      return;
    }
    const blob = new Blob([JSON.stringify(proposals, null, 2)], { type: 'application/json' });
    saveAs(blob, `migration-preview-${new Date().toISOString()}.json`);
  };

  const readyCount = useMemo(() => proposals.filter(p => p.status === 'READY').length, [proposals]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <RoleGate allow={['admin']}>
        <div className="space-y-4">
            <h1 className="text-lg font-semibold md:text-2xl font-headline">
                Store Scope Migration Tool
            </h1>
            <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>Warning: Admin Tool</AlertTitle>
                <AlertDescription>
                    This tool performs irreversible data migrations. Always **Preview** changes before applying. The "Apply" action cannot be undone.
                </AlertDescription>
            </Alert>
            <Card>
                <CardHeader>
                    <CardTitle>Migration Control</CardTitle>
                    <CardDescription>
                        Use these actions to migrate legacy single-store data to the new multi-store format.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                    <Button onClick={handlePreview} disabled={loading || processing}>
                        {loading ? 'Loading Data...' : (processing ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Preview Changes')}
                    </Button>
                    <Button onClick={handleApplyChanges} disabled={processing || readyCount === 0}>
                         {processing ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Apply READY Changes'} ({readyCount})
                    </Button>
                    <Button variant="outline" onClick={handleExport} disabled={proposals.length === 0}>
                        Export Preview JSON
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Migration Preview</CardTitle>
                    <CardDescription>
                        A list of staff and user documents that require migration.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[60vh]">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Legacy Value</TableHead>
                                    <TableHead>Proposed Change</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {proposals.length > 0 ? proposals.map(p => (
                                    <TableRow key={`${p.type}-${p.docId}`}>
                                        <TableCell><Badge variant="secondary">{p.type}</Badge></TableCell>
                                        <TableCell>{p.name}<br/><span className="text-xs text-muted-foreground">{p.docId}</span></TableCell>
                                        <TableCell className="text-xs font-mono">{JSON.stringify(p.legacyFields)}</TableCell>
                                        <TableCell className="text-xs font-mono">{p.status === 'READY' ? JSON.stringify(p.proposedChanges) : 'N/A'}</TableCell>
                                        <TableCell>
                                            <Badge variant={p.status === 'READY' ? 'default' : (p.status === 'UNRESOLVED' ? 'destructive' : 'outline')}>
                                                {p.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs">{p.details}</TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center text-muted-foreground h-24">
                                            {loading ? 'Loading data...' : 'Click "Preview Changes" to begin.'}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
      </RoleGate>
    </main>
  );
}

export default StoreScopeMigrationPage;

