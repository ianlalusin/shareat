
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc } from 'firebase/firestore';

export type RoundingRule = 'none' | '0.25' | '0.50' | '1.00';

export type ThemeOption = 'light' | 'dark' | 'system';
export type CardSizeOption = 'compact' | 'normal';
export type CardDensityOption = 'comfortable' | 'compact';

export interface StoreSettings {
  billing: {
    /** Max discount % that cashier can apply without manager PIN */
    maxDiscountWithoutManager: number; // e.g. 10 means 10%

    /** Rounding rule for totals */
    roundingRule: RoundingRule;

    /** Show centavos (true) or round to whole peso (false) */
    showCentavos: boolean;
  };

  kitchen: {
    /** Minutes before item is considered RUSH */
    rushMinutes: number;

    /** Highlight RUSH cards visually */
    highlightRush: boolean;

    /** Play sound for every new kitchen item */
    playSoundOnNewItem: boolean;

    /** If true, sound only for RUSH items (overrides generic sound) */
    playSoundForRushOnly: boolean;

    /** Show table name on kitchen card */
    showTableName: boolean;

    /** Show package name on kitchen card */
    showPackageName: boolean;

    /** Show refill history (hover/tap) */
    showRefillHistory: boolean;

    /** Browser notification for new HOT items (if supported) */
    showHotNotifications: boolean;
  };

  refill: {
    /** Allow refill encoding even after time limit */
    allowAfterTimeLimit: boolean;

    /** Max refill count per table per item; null = no limit */
    maxRefillPerItem: number | null;

    /** Require reason/notes for marking refill as RUSH */
    requireRushReason: boolean;
  };

  security: {
    /**
     * Auto-logout after X minutes of inactivity
     * 0 or null = disabled (no auto logout yet)
     */
    autoLogoutMinutes: number | null;

    requirePin: {
      /** Require PIN when voiding payments */
      voidPayment: boolean;

      /** Require PIN when cancelling a finalized bill */
      cancelFinalizedBill: boolean;

      /** Require PIN when cancelling an order */
      cancelOrder: boolean;

      /** Require PIN when cancelling an item that has already been served */
      cancelServedItem: boolean;

      /**
       * Require PIN when discount > X%
       * - If null, disable this rule
       * - Usually same as billing.maxDiscountWithoutManager
       */
      discountAbovePercent: number | null;

      /** Require PIN when reprinting receipt */
      reprintReceipt: boolean;

      /** Require PIN when backdating date/time of order */
      backdateOrder: boolean;
    };
  };

  reports: {
    /** Include cancelled orders in reports */
    includeCancelledOrders: boolean;

    /** Mask customer details in reports (for privacy) */
    maskCustomerDetails: boolean;

    /** Show staff name in sales report */
    showStaffName: boolean;
  };

  ui: {
    theme: ThemeOption;
    cardSize: CardSizeOption;
    cardDensity: CardDensityOption;
  };
}

export const defaultStoreSettings: StoreSettings = {
  billing: {
    maxDiscountWithoutManager: 10,
    roundingRule: 'none',
    showCentavos: true,
  },
  kitchen: {
    rushMinutes: 10,
    highlightRush: true,
    playSoundOnNewItem: false,
    playSoundForRushOnly: true,
    showTableName: true,
    showPackageName: true,
    showRefillHistory: false,
    showHotNotifications: false,
  },
  refill: {
    allowAfterTimeLimit: false,
    maxRefillPerItem: null,
    requireRushReason: true,
  },
  security: {
    autoLogoutMinutes: null,
    requirePin: {
      voidPayment: true,
      cancelFinalizedBill: true,
      cancelOrder: true,
      cancelServedItem: true,
      discountAbovePercent: 10,
      reprintReceipt: true,
      backdateOrder: true,
    },
  },
  reports: {
    includeCancelledOrders: true,
    maskCustomerDetails: false,
    showStaffName: true,
  },
  ui: {
    theme: 'system',
    cardSize: 'normal',
    cardDensity: 'comfortable',
  },
};

export async function getStoreSettings(
  firestore: Firestore,
  storeId: string
): Promise<StoreSettings> {
  const ref = doc(firestore, 'storeSettings', storeId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return defaultStoreSettings;
  }

  const data = snap.data() as Partial<StoreSettings>;
  // Deep merge to ensure all nested objects and their properties have defaults
  return {
    billing: {
      ...defaultStoreSettings.billing,
      ...(data.billing || {}),
    },
    kitchen: {
      ...defaultStoreSettings.kitchen,
      ...(data.kitchen || {}),
    },
    refill: {
      ...defaultStoreSettings.refill,
      ...(data.refill || {}),
    },
    security: {
      ...defaultStoreSettings.security,
      ...data.security, // spread shallow first
      requirePin: {
        ...defaultStoreSettings.security.requirePin,
        ...(data.security?.requirePin || {}), // then deep
      },
    },
    reports: {
      ...defaultStoreSettings.reports,
      ...(data.reports || {}),
    },
    ui: {
      ...defaultStoreSettings.ui,
      ...(data.ui || {}),
    },
  };
}
