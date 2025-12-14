
'use client';

import { redirect } from 'next/navigation';
import { useEffect } from 'react';

// This page is deprecated. The login form has been moved to /app/(public)/login/page.tsx.
// This component will redirect any stray traffic.
export default function DeprecatedLoginPage() {
  useEffect(() => {
    redirect('/login');
  }, []);

  return null;
}
