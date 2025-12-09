
'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo } from 'react';
import { useStoreSelector } from '@/store/use-store-selector';
import { useFirestore } from '@/firebase';
import { getStoreSettings, defaultStoreSettings, type StoreSettings } from '@/lib/settings';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';

interface SettingsContextType {
  settings: StoreSettings;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const SettingsLoadingSkeleton = () => (
  <div className="flex h-svh w-full items-center justify-center">
    <div className="w-full max-w-md space-y-4 p-4">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-40 w-full" />
    </div>
  </div>
);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { selectedStoreId } = useStoreSelector();
  const firestore = useFirestore();
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();

  useEffect(() => {
    const fetchSettings = async () => {
      if (!firestore || !selectedStoreId) {
        setSettings(defaultStoreSettings);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const fetchedSettings = await getStoreSettings(firestore, selectedStoreId);
        setSettings(fetchedSettings);
      } catch (error) {
        console.error("Failed to fetch store settings:", error);
        setSettings(defaultStoreSettings);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [selectedStoreId, firestore]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (settings.ui.theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(settings.ui.theme);
    }
  }, [settings.ui.theme]);

  // For mobile, we might want to force compact settings
  const effectiveSettings = useMemo(() => {
    if (isMobile) {
      return {
        ...settings,
        ui: {
          ...settings.ui,
          cardSize: 'compact',
          cardDensity: 'compact',
        }
      }
    }
    return settings;
  }, [settings, isMobile]);

  return (
    <SettingsContext.Provider value={{ settings: effectiveSettings, loading }}>
      {loading ? <SettingsLoadingSkeleton /> : children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
