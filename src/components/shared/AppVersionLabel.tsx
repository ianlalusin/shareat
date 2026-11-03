'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';

/**
 * Shows "v1.0 (build N)" of the installed Android app so a tablet can be told
 * apart from another. The build number is the GitHub run number the APK
 * workflow passes as versionCode. Renders nothing in a browser (there is no
 * APK), before mount, and if the native call fails.
 */
export function AppVersionLabel({ className }: { className?: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    App.getInfo()
      .then((info) => {
        if (!cancelled) setLabel(`v${info.version} (build ${info.build})`);
      })
      .catch((err) => console.warn('[AppVersionLabel] App.getInfo failed', err));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!label) return null;
  return (
    <p data-testid="app-version" className={className ?? 'text-xs text-muted-foreground'}>
      {label}
    </p>
  );
}
