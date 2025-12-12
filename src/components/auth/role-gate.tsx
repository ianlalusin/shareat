
'use client';

import { ReactNode } from 'react';
import { useStaffProfile } from '@/hooks/use-staff-profile';
import type { StaffRole } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface RoleGateProps {
  allow: StaffRole[];     // allowed roles
  children: ReactNode;
}

export function RoleGate({ allow, children }: RoleGateProps) {
  const { staff, role, loading } = useStaffProfile();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!staff || !role) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Alert className="max-w-md" variant="destructive">
          <AlertTitle>No active staff profile</AlertTitle>
          <AlertDescription>
            Your account is not linked to an active staff record. Please contact the admin.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!allow.includes(role)) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Alert className="max-w-md" variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            Your role (<strong>{staff.position}</strong>) is not allowed to access this page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
