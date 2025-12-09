
'use client';

import { useAuthContext } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/firebase';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';

export default function AccountPage() {
  const { user, devMode, setDevMode } = useAuthContext();
  const router = useRouter();
  const auth = useAuth();

  const handleLogout = async () => {
    if (devMode) {
      setDevMode(false);
    }
    if (user) {
      await signOut(auth);
    }
    router.push('/login');
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <h1 className="text-lg font-semibold md:text-2xl font-headline">
        Account Information
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>My Account</CardTitle>
          <CardDescription>
            Manage your account settings and preferences.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">User</p>
            <p>{devMode ? 'Developer Mode' : user?.email || 'Not signed in'}</p>
          </div>
           <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Name</p>
            <p>{user?.displayName || (devMode ? 'Dev User' : 'N/A')}</p>
          </div>
          <Button variant="destructive" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Log Out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
