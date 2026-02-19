import { Timestamp } from "firebase/firestore";
import type { ReceiptData, ReceiptSession, ReceiptSettings } from "@/components/receipt/receipt-view";

export type UserRole = 'admin' | 'manager' | 'cashier' | 'kitchen' | 'server' | 'pending';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  role: UserRole;
}

export interface Session {
  user: User | null;
  loading: boolean;
}

export interface UserDocument {
    displayName: string;
    email: string;
    role: UserRole;
    photoURL?: string;
}

export type Product = {
  id: string;
  name: string;
  
  // Legacy single-variant label. Use getEffectiveVariantLabel() helper.
  variant?: string;
  
  // New Variant Management
  kind?: "single" | "group" | "variant";
  groupId?: string | null;
  groupName?: string | null;
  variantLabel?: string | null;
  isSku?: boolean;
  
  category: string;
  subCategory?: string;
  uom: string;
  barcode?: string;
  imageUrl?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type InventoryItem = {
  id: string;
  productId: string;
  name: string;
  variantLabel?: string | null;
  category?: string;
  subCategory?: string;
  uom: string;
  barcode?: string | null;
  imageUrl?: string | null;
  cost: number;
  sellingPrice: number;
  taxId?: string;
  isActive: boolean;
  isAddon?: boolean;
  isArchived?: boolean;
  kitchenLocationId?: string | null;
  kitchenLocationName?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Flavor = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Package = {
  id: string;
  name: string;
  allowedRefillIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Refill = {
  id: string;
  name: string;
  requiresFlavor: boolean;
  allowedFlavorIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};


export type StorePackage = {
    packageId: string;
    packageName: string;
    isEnabled: boolean;
    pricePerHead: number;
    kitchenLocationId: string | null;
    kitchenLocationName: string | null;
    refillsAllowed: string[];
    flavorsAllowed: string[];
    sortOrder: number;
    menuScheduleId: string | null;
};

export type StoreFlavor = {
    flavorId: string,
    flavorName: string, // denormalized
    isEnabled: boolean,
    sortOrder: number,
}

export type StoreRefill = {
    refillId: string,
    refillName: string, // denormalized
    isEnabled: boolean,
    sortOrder: number,
    kitchenLocationId: string | null;
    kitchenLocationName: string | null;
    flavorsAllowed?: string[] | null;
    menuScheduleId?: string | null;
};

export type KitchenLocation = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuSchedule = {
  id: string;
  name: string;
  isActive?: boolean;
  isArchived?: boolean;
  days?: string[];
  startTime?: string;
  endTime?: string;
  timezone?: string;
};

export type OrderItemStatus = "preparing" | "ready" | "served" | "cancelled" | "void";

export type OrderItemType = "package" | "refill" | "addon";

export type KitchenTicket = {
    id: string;
    sessionId: string;
    storeId: string;
    tableId: string;
    tableNumber: string;
    type: OrderItemType;
    itemId?: string;
    itemName: string;
    guestCount: number;
    status: OrderItemStatus;
    kitchenLocationId: string;
    kitchenLocationName?: string;
    notes?: string;
    qty: number;
    uom?: string;
    createdByUid: string;
    createdAt: any;
    createdAtClientMs?: number;
    updatedAt?: any;
    preparedByUid?: string | null;
    preparedAt?: any | null;
    servedByUid?: string | null;
    servedAt?: any | null;
    servedAtClientMs?: number;
    servedCounted?: boolean;
    cancelledByUid?: string | null;
    cancelledAt?: any | null;
    cancelReason?: string;
    cancelledAtClientMs?: number;
    durationMs?: number;
    initialFlavorIds?: string[];
    initialFlavorNames?: string[];
    sessionMode?: 'package_dinein' | 'alacarte';
    customerName?: string | null;
    sessionLabel?: string;
    orderedByRole?: UserRole | null;
    billLineId?: string; // Link to SessionBillLine
    billing?: {
        isVoided: boolean;
        voidReason?: string | null;
        voidNote?: string | null;
        isFree: boolean;
        discountType?: "percent" | "fixed" | null;
        discountValue?: number | null;
        itemId: string;
        itemName: string;
        unitPrice: number;
    }
};

export type BillableLine = {
  id: string;
  type: "package" | "addon";
  itemId: string;
  itemName: string;
  categoryName?: string | null;
  barcode?: string | null;
  unitPrice: number;
  qtyOrdered: number;
  discountQty: number;
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
  freeQty: number;
  voidedQty: number;
  createdAt?: any;
  updatedAt?: any;
};

export type SessionBillLine = {
  id: string;
  type: "package" | "addon";
  itemId: string;
  itemName: string;
  category?: string | null;
  barcode?: string | null;
  unitPrice: number;
  qtyOrdered: number;
  discountType: "percent" | "fixed" | null;
  discountValue: number | null;
  discountQty: number;
  freeQty: number;
  voidedQty: number;
  /**
   * Multiple line-level discounts/charges stored on the bill line (source of truth).
   * Map keyed by adjustment id for easy removal.
   */
  lineAdjustments?: Record<string, LineAdjustment>;
  qtyOverrideActive?: boolean;
  qtyOverrideAt?: any;
  qtyLastSyncedApprovedAt?: string | null;
  createdAt: any;
  updatedAt: any;
  updatedByUid?: string | null;
  updatedByName?: string | null;
  kitchenLocationId?: string | null;
  kitchenLocationName?: string | null;
};

export type LineAdjustmentKind = "discount" | "charge";

export type LineAdjustment = {
  id: string;
  kind: LineAdjustmentKind;      // discount | charge
  note: string;                 // label shown in UI
  type: "fixed" | "percent";    // fixed amount or percent
  value: number;                // amount or percent value
  qty: number;                  // apply to how many items in the line
  refId?: string | null;        // preset id if any
  stackable?: boolean;          // snapshot at time of apply
  createdAtClientMs: number;
  createdByUid: string;
  createdByName?: string;
};

export type Payment = {
    id: string;
    methodId: string;
    amount: number;
    reference?: string;
};

export type Adjustment = {
  id: string;
  note: string;
  amount: number;
  type: 'fixed' | 'percent';
  source: 'charge' | 'custom';
  sourceId?: string;
};

export type Charge = {
  id: string;
  name: string;
  type: "fixed" | "percent";
  value: number;
  appliesTo: "subtotal" | "total";
  isEnabled: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
};

export type Discount = {
  id: string;
  name: string;
  type: "fixed" | "percent";
  value: number;
  scope: ("bill" | "item")[];
  stackable: boolean;
  isEnabled: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
};

export type ModeOfPayment = {
  id: string;
  name: string;
  type: "cash" | "card" | "online" | "other";
  sortOrder: number;
  isActive: boolean;
  hasRef: boolean;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
};

export type Store = {
  id: string;
  name: string;
  code: string;
  address: string;
  tin?: string;
  logoUrl?: string | null;
  vatType?: "VAT" | "NON_VAT"; // Deprecated
  taxType?: "VAT_INCLUSIVE" | "VAT_EXCLUSIVE" | "NON_VAT";
  taxRatePct?: number;
  isActive: boolean;
  openingDate?: Timestamp | null;
  openingTime?: string;
  closingTime?: string;
  contactNumber?: string;
  email?: string;
  createdAt: any;
  updatedAt: any;
};

export type StoreTable = {
    id: string; // e.g., T1, T2
    code: string;
    tableNumber: string;
    displayName: string;
    isActive: boolean;
    status: 'available' | 'occupied' | 'reserved' | 'out_of_order';
    currentSessionId: string | null;
};

export type PendingSession = {
  id: string;
  storeId: string; // Added for convenience
  tableId?: string;
  tableNumber: string;
  tableDisplayName?: string | null;
  packageName: string;
  status: 'pending_verification' | 'active' | 'closed' | 'voided';
  sessionMode: 'package_dinein' | 'alacarte';
  customerName?: string | null;
  isPaid?: boolean;
  packageOfferingId: string;
  packageSnapshot?: { id?: string; name?: string; pricePerHead?: number } | null;
  initialFlavorIds?: string[];
  startedAt: Timestamp;
  startedAtClientMs?: number | null;
  // Guest Count Model
  guestCountCashierInitial: number;
  guestCountServerVerified: number | null;
  guestCountFinal: number | null;
  guestCountVerifyLocked: boolean;
  // Change Request Models
  guestCountChange?: { status: "none" | "pending" | "approved" | "rejected", approvedAt?: any };
  packageChange?: { status: string };
  customer?: { name?: string | null, tin?: string | null, address?: string | null };
};

export type TopRefillRow = { name: string; qty: number };
export type TopAddonRow = { name: string; qty: number; amount: number; categoryName: string; };

export type DailyMetric = {
    meta: {
        dayId?: string;
        storeId: string;
        dayStartMs?: number;
        updatedAt: any;
        backfilledAt?: any;
        source?: string;
        presetId?: string;
        rangeStartMs?: number;
        rangeEndMs?: number;
    };
    payments?: {
        totalGross: number;
        txCount: number;
        byMethod: {
            [methodName: string]: number;
        };
        discountsTotal?: number;
        chargesTotal?: number;
    };
    guests?: {
        guestCountFinalTotal?: number;
        packageSessionsCount?: number;
        packageCoversBilledByPackageName?: {
            [packageName: string]: number;
        };
        guestCountFinalByPackageName?: Record<string, number>;
    };
    sales?: {
        packageSalesAmountByName: Record<string, number>;
        packageSalesQtyByName: Record<string, number>;
        addonSalesAmountByCategory: Record<string, number>;
        addonSalesQtyByCategory: Record<string, number>;
        addonSalesByItem?: Record<string, { qty: number; amount: number; categoryName: string; }>;
        dineInAddonSalesAmount?: number;
        salesAmountByHour: Record<string, number>;
        sessionCountByHour: Record<string, number>;
        topAddonsByQty?: TopAddonRow[];
    };
    kitchen?: {
        servedCountByType: Record<string, number>;
        cancelledCountByType: Record<string, number>;
        durationMsSumByType: Record<string, number>;
        durationCountByType: Record<string, number>;
        durationMsSumByLocation?: Record<string, number>;
        durationCountByLocation?: Record<string, number>;
    };
    sessions?: {
        closedCount: number;
        totalPaid: number;
    };
    refills?: {
        servedRefillsTotal: number;
        servedRefillsByName: Record<string, number>;
        packageSessionsCount: number;
        topRefillsByQty?: TopRefillRow[];
    };
}

export type ReceiptAnalyticsV2 = {
  v: 2;
  sessionStartedAt: any | null;
  sessionStartedAtClientMs?: number | null;
  sessionStartedAtHour?: number | null;
  subtotal: number;
  discountsTotal: number;
  chargesTotal: number;
  taxAmount: number;
  grandTotal: number;
  totalPaid: number;
  change: number;
  mop: Record<string, number>;
  salesByItem?: Record<string, { qty: number; amount: number; categoryName: string; }>;
  salesByCategory?: Record<string, { qty: number; amount: number; }>;
  addonSalesByItem?: Record<string, { qty: number; amount: number; }>; // New field
  servedRefillsByName?: Record<string, number>;
  serveCountByType?: Record<string, number>;
  serveTimeMsTotalByType?: Record<string, number>;
  guestCountSnapshot?: {
    packageOfferingId?: string | null;
    packageName?: string | null;
    finalGuestCount: number;
    billedPackageCovers: number;
    discrepancy: number;
    computedAtClientMs: number;
    rule: "MAX";
  };
};

export type Receipt = {
    id: string;
    storeId: string;
    sessionId: string;
    createdAt: any;
    createdAtClientMs: number;
    createdByUid: string;
    createdByUsername: string;
    sessionMode: 'package_dinein' | 'alacarte';
    tableId: string | null;
    tableNumber: string | null;
    customerName: string | null;
    customerAddress?: string | null;
    customerTin?: string | null;
    lines: SessionBillLine[];
    total: number;
    totalPaid: number;
    change: number;
    status: 'final' | 'voided';
    receiptSeq: number;
    receiptNumber: string;
    receiptNoFormatUsed: string;
    analytics?: any | ReceiptAnalyticsV2;
    analyticsApplied?: boolean;
    analyticsAppliedAt?: any;
    analyticsApplyId?: string;
    // Fields for editing audit trail
    isEdited?: boolean;
    editVersion?: number;
    editedAt?: any;
    editedByUid?: string;
    editedByEmail?: string | null;
    editReason?: string;
    lastDiffSummary?: string;
    // New fields for explicit discount auditing
    discounts?: {
        bill?: any;
        items?: any[];
    };
    discountsTotal?: number;
    discountEventIds?: string[];
    // Fields for voiding
    voidedAt?: any;
    voidedByUid?: string;
    voidedByEmail?: string | null;
    voidReason?: string;
}

export type DiscountEvent = {
  id: string;
  storeId: string;
  receiptId: string;
  receiptNumber: string;
  sessionId: string;
  scope: "bill" | "item";
  actionType: "DISCOUNT_APPLIED" | "DISCOUNT_EDITED" | "DISCOUNT_REMOVED";
  billDiscount: {
    discountType: "fixed" | "percent";
    discountName: string;
    percent?: number | null;
    amount: number;
  } | null;
  itemDiscount: {
    lineId: string;
    itemId?: string;
    itemName: string;
    qtyAffected?: number;
    discountType: "percent" | "fixed";
    percent?: number | null;
    amount: number;          // absolute currency amount for this event
  } | null;
  reason?: string | null;
  createdAt: any;
  createdByUid: string;
  createdByName: string;
  createdByRole: string;
};


export type ActivityLog = {
  id: string;
  sessionId: string;
  storeId: string;

  action: "SESSION_STARTED" | "SESSION_VOIDED" | "DISCOUNT_APPLIED" | "DISCOUNT_EDITED" | "DISCOUNT_REMOVED" | "MARK_FREE" | "UNMARK_FREE" | "VOID_TICKETS" | "UNVOID" | "PRICE_OVERRIDE" | "PAYMENT_COMPLETED" | "edit_line" | "PACKAGE_QTY_OVERRIDE_SET" | "PACKAGE_QTY_RESYNC_APPROVED_CHANGE" | "RECEIPT_DELETED" | "RECEIPT_EDITED" | "RECEIPT_VOIDED" | "SESSION_VERIFIED";

  actorUid: string;
  actorRole?: string | null;
  actorName?: string | null;
  
  lineId?: string;
  
  before?: any;
  after?: any;

  reason?: string | null;
  note?: string | null;

  // Denormalized session context for performant log reading
  sessionLabel?: string;
  sessionStatus?: 'pending_verification' | 'active' | 'closed' | 'voided';
  sessionStartedAt?: any;
  sessionMode?: 'package_dinein' | 'alacarte';
  customerName?: string | null;
  tableNumber?: string | null;

  meta?: {
    itemId?: string;
    itemName?: string;
    discountType?: "fixed" | "percent" | null;
    discountValue?: number | null;
    unitPriceBefore?: number | null;
    unitPriceAfter?: number | null;
    qty?: number;
    isFreeBefore?: boolean | null;
    isFreeAfter?: boolean | null;
    isVoidedBefore?: boolean | null;
    isVoidedAfter?: boolean | null;

    receiptId?: string;
    receiptNumber?: string;
    paymentTotal?: number;
    mopSummary?: any;
    
    // For overrides and syncs
    beforeQty?: number;
    afterQty?: number;
    approvedAt?: any;
    newQty?: number;
    amount?: number;
    editVersion?: number;
    diffSummary?: string;
    reason?: string;
    total?: number;
    snapshot?: Receipt;
    sessionLabel?: string;

    // For discount auditing
    scope?: "bill" | "item";
    oldDiscountTotal?: number;
    newDiscountTotal?: number;
    delta?: number;
    discountName?: string;
    percent?: number;
    
    serverCount?: number;
    finalCount?: number;
  };

  createdAt: any; // serverTimestamp()
};

export type PackageUnit = {
    guestId: string;
    packageId: string;
    packageName: string;
    unitPrice: number;
    createdAt: any;
    billing: {
        isFree: boolean;
        discountType?: "percent" | "fixed" | null;
        discountValue?: number | null;
    }
}

/**
 * Represents the real-time KDS document for a single kitchen station.
 * Path: /stores/{storeId}/rtKdsTickets/{kitchenLocationId}
 */
export type RtKdsStationDoc = {
  meta: {
    source: string;
    updatedAt: Timestamp;
  };
  kitchenLocationId: string;
  activeIds: string[]; // Array of active ticket IDs for sorting
  tickets: Record<string, KitchenTicket>; // Map of ticketId to ticket data
  sessionIndex: Record<string, string[]>; // Map of sessionId to its ticketIds
};

export type WeatherCondition = "sunny" | "cloudy" | "light_rain" | "heavy_rain";

export type WeatherEntry = {
  timestamp: Timestamp;
  condition: WeatherCondition;
  activeSessionCount: number;
  activeGuestCount: number;
  loggedByUid: string;
};

export type WeatherRecord = {
  dayId: string;
  entries: WeatherEntry[];
};

export type SalesForecast = {
  date: string; // YYYY-MM-DD
  projectedSales: number;
  actualSales?: number;
  accuracy?: number;
  createdAt: Timestamp;
};

export type { ReceiptData, ReceiptSession, ReceiptSettings };
