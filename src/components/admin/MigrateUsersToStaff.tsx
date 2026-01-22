'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthContext } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, Users } from 'lucide-react';
import { db } from '@/lib/firebase/client';
import { collection, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';

export function MigrateUsersToStaff() {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<{ migrated: number; skipped: number } | null>(null);

  if (appUser?.role !== 'admin') {
    return null; // This component is strictly for admins
  }

  const handleMigration = async () => {
    setIsMigrating(true);
    setMigrationResult(null);
    toast({ title: "Migration Started", description: "Fetching users and preparing to migrate to staff collection." });

    try {
      const usersRef = collection(db, "users");
      const staffRef = collection(db, "staff");
      
      const [usersSnapshot, staffSnapshot] = await Promise.all([
          getDocs(usersRef),
          getDocs(staffRef)
      ]);

      const existingStaffIds = new Set(staffSnapshot.docs.map(doc => doc.id));
      let migratedCount = 0;
      let skippedCount = 0;

      const batch = writeBatch(db);

      usersSnapshot.forEach(userDoc => {
        const userId = userDoc.id;
        const userData = userDoc.data();

        if (existingStaffIds.has(userId)) {
          skippedCount++;
          return; // Skip if staff document already exists
        }

        const staffDocRef = doc(staffRef, userId);
        const newStaffData = {
          address: userData.address || null,
          assignedStoreIds: userData.assignedStoreIds || [],
          contactNumber: userData.contactNumber || null,
          createdAt: userData.createdAt || serverTimestamp(),
          email: userData.email || null,
          name: userData.name || userData.displayName || null,
          role: userData.role || 'server',
          staffId: userId, // Ensure staffId is the user's UID
          status: userData.status || 'pending',
          updatedAt: userData.updatedAt || serverTimestamp(),
          photoURL: userData.photoURL || null,
        };
        
        batch.set(staffDocRef, newStaffData);
        migratedCount++;
      });
      
      if (migratedCount > 0) {
          await batch.commit();
      }

      setMigrationResult({ migrated: migratedCount, skipped: skippedCount });
      toast({
        title: "Migration Complete",
        description: `Migrated ${migratedCount} users. Skipped ${skippedCount} already existing staff members.`,
      });

    } catch (error: any) {
      console.error("Migration failed:", error);
      toast({ variant: 'destructive', title: "Migration Failed", description: error.message });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <Card className="bg-muted/30">
        <CardHeader>
            <CardTitle>Users to Staff Migration</CardTitle>
            <CardDescription>
                One-time tool to migrate data from the deprecated `/users` collection to `/staff`.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <Alert variant="destructive">
                <AlertTitle>Warning: Potentially Destructive</AlertTitle>
                <AlertDescription>
                    This tool will create new documents in the `/staff` collection. It will skip any users that already have a corresponding staff profile.
                </AlertDescription>
            </Alert>
            
            {migrationResult && (
                <Alert>
                    <AlertTitle>Result</AlertTitle>
                    <AlertDescription>
                        Migrated: {migrationResult.migrated} | Skipped: {migrationResult.skipped}
                    </AlertDescription>
                </Alert>
            )}

            <Button
                onClick={handleMigration}
                disabled={isMigrating}
                className="w-full"
            >
                {isMigrating ? <Loader2 className="animate-spin mr-2" /> : <Users className="mr-2" />}
                Migrate /users to /staff
            </Button>
        </CardContent>
    </Card>
  );
}
