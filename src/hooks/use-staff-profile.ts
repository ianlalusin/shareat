
'use client';

import { useEffect, useState } from 'react';
import { useFirestore } from '@/firebase';
import { useAuthContext } from '@/context/auth-context';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import type { Staff, StaffRole } from '@/lib/types';

// Helper: normalize Firestore position → StaffRole | null
function normalizeRole(position?: string | null): StaffRole | null {
  if (!position) return null;
  const p = position.toLowerCase();
  if (p === 'admin') return 'admin';
  if (p === 'manager') return 'manager';
  if (p === 'cashier') return 'cashier';
  if (p === 'server') return 'server';
  if (p === 'kitchen' || p === 'kitchen staff' || p === 'kitchen_staff') return 'kitchen';
  return null;
}

export interface StaffState {
  staff: Staff | null;
  role: StaffRole | null;
  loading: boolean;
}

export function useStaffProfile(): StaffState {
  const firestore = useFirestore();
  const { user } = useAuthContext();

  const [staff, setStaff] = useState<Staff | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firestore || !user) {
      setStaff(null);
      setRole(null);
      setLoading(false);
      return;
    }

    const staffRef = collection(firestore, 'staff');
    // main: match authUid
    const q = query(
      staffRef,
      where('authUid', '==', user.uid),
      where('employmentStatus', '==', 'Active'),
      limit(1)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          // Fallback: try uid field if authUid not populated yet
          const fallbackQ = query(
            staffRef,
            where('uid', '==', user.uid),
            where('employmentStatus', '==', 'Active'),
            limit(1)
          );
          const unsubFallback = onSnapshot(
            fallbackQ,
            (snap2) => {
              if (snap2.empty) {
                setStaff(null);
                setRole(null);
              } else {
                const d = snap2.docs[0];
                const data = { id: d.id, ...d.data() } as Staff;
                setStaff(data);
                setRole(normalizeRole(data.position));
              }
              setLoading(false);
            },
            () => {
              setStaff(null);
              setRole(null);
              setLoading(false);
            }
          );
          // small trick so we don't leak the fallback
          return () => unsubFallback();
        } else {
          const d = snap.docs[0];
          const data = { id: d.id, ...d.data() } as Staff;
          setStaff(data);
          setRole(normalizeRole(data.position));
          setLoading(false);
        }
      },
      () => {
        setStaff(null);
        setRole(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [firestore, user]);

  return { staff, role, loading };
}
