
import { Timestamp } from "firebase/firestore";

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

  // Variant label for single-kind products. The display name is "name (variant)"
  // when set. Distinct from `description`; see comment below. Legacy callers used
  // this field for free-text notes — kept for backward compat via the dialog UI.
  variant?: string;

  // Free-text description / notes shown to staff in the editor. NOT used as a
  // variant label or appended to the display name.
  description?: string;

  // New Variant Management
  kind?: "single" | "group" | "variant";
  groupId?: string | null;
  groupName?: string | null;
  variantLabel?: string | null;
  isSku?: boolean;

  // Modifier / option group references. Order at attach time; the cashier
  // and the customer modifier pickers iterate in this order. For variants
  // (kind: "variant"), modifiers are inherited from the parent group product;
  // per-variant overrides are not supported in this phase.
  optionGroupIds?: string[];

  category: string;
  subCategory?: string;
  uom: string;
  barcode?: string;
  imageUrl?: string;
  isActive: boolean;
  /**
   * Soft-deleted. Archiving auto-deactivates the product and pins it into the
   * bottom-most "Archived" group on /admin/menu/products. Archived products
   * never appear in the cashier addon picker. Restoring clears both flags via
   * the restore action.
   */
  isArchived?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/**
 * A reusable, global option group attached to one or more Products.
 * At order time the cashier and customer modifier pickers iterate the
 * groups attached to the chosen product and let the user pick from each
 * group's `values`. Selected values become `modifiers[]` on the bill line
 * and kitchen ticket, each contributing its `priceDelta` to the line total.
 *
 * Examples:
 *   { name: "Cheese", selectionMode: "multi", values: [
 *     { name: "Extra Cheese", priceDelta: 20 },
 *     { name: "No Cheese", priceDelta: 0 },
 *   ]}
 *   { name: "Size", selectionMode: "single", required: true, values: [
 *     { name: "Small", priceDelta: 0 },
 *     { name: "Large", priceDelta: 40 },
 *   ]}
 */
export type OptionGroupValue = {
  id: string;            // stable; survives renames; used in receipts/analytics
  name: string;
  priceDelta: number;    // peso amount, signed; 0 is the default
  isActive: boolean;
  sortOrder: number;
};

export type OptionGroup = {
  id: string;
  name: string;
  selectionMode: "single" | "multi";
  required: boolean;       // single: must pick a value; multi: requires >= minSelections
  minSelections?: number;  // multi only
  maxSelections?: number;  // multi only; undefined = unlimited
  values: OptionGroupValue[];
  isActive: boolean;
  isArchived?: boolean;
  createdAt: any;
  updatedAt: any;
};

export type InventoryItem = {
  id: string;
  productId: string;
  name: string;
  variantLabel?: string | null;
  /**
   * Family / variant metadata mirrored from the underlying Product.
   * Populated by the merge endpoint and the sync-inventory backfill so the
   * cashier addons picker can group variants under their family without
   * an extra Product read per addon. See:
   *  - /api/admin/products/merge
   *  - /api/admin/products/sync-inventory-from-products
   */
  kind?: "single" | "group" | "variant";
  groupId?: string | null;
  groupName?: string | null;
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
    isOther?: boolean; // shows under "Other Refills" steppers
    menuScheduleId?: string | null;
};

export type KitchenLocation = {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  /**
   * Per-station serve-time SLA in minutes. The KDS ages each active ticket
   * against this and flags ones running late. Absent → falls back to a global
   * default. See the kitchen page's slow-ticket alerting.
   */
  slaMinutes?: number;
};

/**
 * Forward booking. Lives at stores/{storeId}/reservations/{id} and is managed
 * from the dedicated /reservations page. The SHAREAT website writes into the
 * same collection with source:"website". When a party is seated, the
 * reservation links to the created cashier session via sessionId.
 */
/**
 * Cash handover / till log. Lives at stores/{storeId}/cashHandovers/{id} and is
 * recorded from /cashier/handover at shift change. Purely a log for
 * accountability — inventory/accounting truth lives in the ERP. expectedCash =
 * startingCash + cashSales − deductionsTotal; variance = countedCash −
 * expectedCash.
 */
export type CashHandoverDeduction = {
  id: string;
  amount: number;
  reason: string;
  encodedByUid?: string | null;
  encodedByName?: string | null;
  createdAtClientMs: number;
};

export type CashHandover = {
  id: string;
  shiftDayId: string;
  periodStartMs: number;
  periodEndMs: number;
  startingCash: number;
  cashSales: number;
  deductions: CashHandoverDeduction[];
  deductionsTotal: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  outgoingCashierName: string;
  incomingCashierName: string;
  notes?: string | null;
  createdAt?: Timestamp | null;
  createdAtClientMs: number;
  createdByUid?: string | null;
  createdByName?: string | null;
};

export type ReservationStatus = "booked" | "confirmed" | "seated" | "cancelled" | "no_show";

export type Reservation = {
  id: string;
  customerName: string;
  phone?: string | null;
  partySize: number;
  reservedForMs: number;          // exact date+time of the booking
  reservedForDayId: string;       // YYYYMMDD (Asia/Manila), for day filtering
  tableId?: string | null;        // optional pre-assignment
  tableNumber?: string | null;
  status: ReservationStatus;
  source: "pos" | "website";
  sessionId?: string | null;      // set when seated
  notes?: string | null;
  createdAt?: Timestamp | null;
  createdAtClientMs: number;
  createdByUid?: string | null;
  createdByName?: string | null;
  updatedAt?: Timestamp | null;
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

export type OrderItemStatus = "preparing" | "ready" | "served" | "cancelled" | "void" | "partially_served";

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
    // --- Batch-serve fields (addon tickets only) ---
    qtyOrdered?: number;    // total qty ordered (e.g. 80)
    qtyServed?: number;     // cumulative qty served across all batches
    qtyCancelled?: number;  // qty cancelled
    qtyRemaining?: number;  // qtyOrdered - qtyServed - qtyCancelled
    serveLog?: {
      qty: number;
      servedAt: number;
      servedAtClientMs: number;
      servedByUid: string;
      servedByName?: string;
    }[];
    refillRequest?: {
        /** Extra refill counts requested via customer app buttons */
        rice?: number;   // integer
        cheese?: number; // integer
    };

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
    };

    // Modifier selections applied at order time. Driven by the product's
    // attached OptionGroups; see OptionGroup type. Present only on tickets
    // whose product had option groups and where the cashier picked values.
    modifiersText?: string;        // "Large, Extra Cheese" — for KDS display
    modifiers?: SelectedModifier[];
};

export type SelectedModifier = {
  groupId: string;
  groupName: string;
  valueId: string;
  valueName: string;
  priceDelta: number;
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
  // Modifier metadata mirrors SessionBillLine. See SelectedModifier type.
  modifiers?: SelectedModifier[];
  modifiersText?: string;
  modifiersTotal?: number;     // sum of priceDelta across selected modifiers (per unit)
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
  /**
   * Modifier selections recorded at order time. The line-id includes a hash
   * of these selections so the same product with different modifier picks
   * lives on separate bill lines. See SelectedModifier and OptionGroup types.
   */
  modifiers?: SelectedModifier[];
  modifiersText?: string;
  /**
   * Sum of selected priceDeltas, per unit. Line total math is:
   *   (unitPrice + modifiersTotal) * qty - line-level discounts/charges.
   */
  modifiersTotal?: number;
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
  appliesTo?: "subtotal" | "total";
};

export type Charge = {
  id: string;
  name: string;
  type: "fixed" | "percent";
  value: number;
  appliesTo: "subtotal" | "total";
  // Scope controls WHERE the charge can be applied: at the bill level, at the
  // item line level, or both. Missing on legacy docs; consumers must coalesce
  // a missing value to ["bill"] for backward compatibility.
  scope?: ("bill" | "item")[];
  isEnabled: boolean;
  sortOrder: number;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy: string;
  // Admin-override fields (set by platform admin on store-scoped charges)
  adminSuspended?: boolean;
  adminSuspendedAt?: any;
  adminSuspendedBy?: string;
  // UI-runtime marker (not persisted) — added when merging global entries client-side
  source?: "store" | "global";
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
  // Optional date-gated availability window. Interpreted as local YYYY-MM-DD
  // strings, inclusive on both ends. Only populated on universal (global)
  // discounts today — store-scoped ones leave these undefined.
  startDate?: string;
  endDate?: string;
  // Admin-override fields (set by platform admin on store-scoped discounts)
  adminSuspended?: boolean;
  adminSuspendedAt?: any;
  adminSuspendedBy?: string;
  // UI-runtime marker (not persisted) — added when merging global entries client-side
  source?: "store" | "global";
};

// Platform-scoped universal discount/charge configured by admin
export type GlobalDiscount = Omit<Discount, "source" | "adminSuspended" | "adminSuspendedAt" | "adminSuspendedBy"> & {
  applicableStoreIds: string[];
};

export type GlobalCharge = Omit<Charge, "source" | "adminSuspended" | "adminSuspendedAt" | "adminSuspendedBy"> & {
  applicableStoreIds: string[];
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

export type ForecastConfig = {
  customHolidays?: { name: string; date: string }[]; // date in YYYY-MM-DD
  payrollScheduleType?: 'semi_monthly_15_eom' | 'weekly' | 'bi_weekly' | 'custom';
  customPayrollDates?: number[]; // day-of-month numbers (1–31), e.g. [5, 20]
  payrollWeekday?: number; // 0=Sun..6=Sat for weekly/bi-weekly
  storeContext?: string; // free-text AI context, e.g. "near a university"
};

export type LoyaltyConfig = {
  isEnabled: boolean;
  pointsPerPeso: number; // e.g. 0.01 = 1 point per ₱100
  /** Minutes a self-redeemed Hub voucher stays valid before it expires and refunds. Default 60. */
  redemptionExpiryMinutes?: number;
};

/**
 * A global (program-wide) loyalty reward members can redeem points for.
 * Managed by platform admin in the POS; read by the Customer Hub. v1 reward
 * types apply as a bill discount when redeemed.
 */
export type LoyaltyReward = {
  id: string;
  name: string;
  description?: string | null;
  pointsCost: number;
  type: "fixed" | "percent"; // fixed = ₱ off, percent = % off the bill
  value: number;
  isActive: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
  /** Optional store scoping; absent ⇒ available at all stores. */
  applicableStoreIds?: string[] | null;
  /** Max times one customer may claim this reward within a single visit. Default 1. */
  maxPerVisit?: number;
  /** Max total claims of this reward per store. null/0/absent ⇒ unlimited. */
  maxClaimsPerStore?: number | null;
  /** Running claim counter per store, maintained on redeem/reverse. */
  claimsByStore?: Record<string, number>;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
};

export type LoyaltyRedemptionStatus = "active" | "applied" | "expired" | "cancelled";

/**
 * A redemption record / voucher. Created when a member redeems a reward (points
 * are debited at creation). Hub-created vouchers carry a short `code` the
 * cashier enters; POS-created ones are applied immediately (status "applied").
 */
export type LoyaltyRedemption = {
  id: string;
  code: string;
  phone: string;
  rewardId: string;
  rewardName: string;
  pointsCost: number;
  type: "fixed" | "percent";
  value: number;
  status: LoyaltyRedemptionStatus;
  source: "hub" | "pos";
  createdAt?: any;
  createdAtClientMs: number;
  expiresAtMs: number;
  appliedStoreId?: string | null;
  appliedSessionId?: string | null;
  appliedReceiptId?: string | null;
  appliedByUid?: string | null;
  appliedAtMs?: number | null;
  refundedAtMs?: number | null;
};

/**
 * Snapshot of an applied loyalty reward stored on a session. A session can hold
 * several (`session.loyaltyRedemptions`), each a different reward; bill totals
 * sum them. Drives the bill discount math.
 */
export type SessionLoyaltyRedemption = {
  redemptionId: string;
  rewardId: string;
  rewardName: string;
  type: "fixed" | "percent";
  value: number;
  pointsCost: number;
  phone: string;
};

export type SharelebratorLink = {
  linkedCustomerPhone?: string | null;
  linkedCustomerName?: string | null;
  linkedCustomerLockedAt?: any; // Timestamp when session closed
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
  /**
   * When true, this store is bookable from the public SharEat website. The
   * website (shareat-website project) reads this flag via an Admin SDK function
   * to decide which branches to show on its reservation form.
   */
  acceptsReservations?: boolean;
  /**
   * Session modes this store offers. Drives which start-session options the
   * cashier sees (e.g. a take-out kiosk with no dine-in sets offersUnlimited
   * false). Absent ⇒ treated as offered, so existing stores keep both.
   */
  offersAlaCarte?: boolean;
  offersUnlimited?: boolean;
  forecastConfig?: ForecastConfig;
  loyaltyConfig?: LoyaltyConfig;
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
  billDiscount?: Discount | null;
  customAdjustments?: Adjustment[];
  billingRevision?: number;
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
        txCountByMode?: { dineIn: number; walkIn: number };
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
        dineInSalesGross?: number;
        dineInDiscountsTotal?: number;
        dineInChargesTotal?: number;
        salesAmountByHour: Record<string, number>;
        sessionCountByHour: Record<string, number>;
        topAddonsByQty?: TopAddonRow[];
        salesAmountByHourByMode?: {
            dineIn: Record<string, number>;
            walkIn: Record<string, number>;
        };
        sessionCountByHourByMode?: {
            dineIn: Record<string, number>;
            walkIn: Record<string, number>;
        };
        salesAmountByMode?: { dineIn: number; walkIn: number };
        netSalesByMode?: { dineIn: number; walkIn: number };
        salesAmountByDow?: Record<string, number>;
        sessionCountByDow?: Record<string, number>;
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
        closedCountByMode?: { dineIn: number; walkIn: number };
        // Sum of dine-in (package) session durations and the count of sessions
        // that contributed a valid duration. Average = sum / count.
        dineInDurationMsSum?: number;
        dineInDurationCount?: number;
    };
    refills?: {
        servedRefillsTotal: number;
        servedRefillsByName: Record<string, number>;
        packageSessionsCount: number;
        topRefillsByQty?: TopRefillRow[];
    };
    items?: {
        voidedQty: number;
        voidedAmount: number;
        freeQty: number;
        freeAmount: number;
        discountedQty: number;
        discountedAmount: number;
        refundCount: number;
        refundTotal: number;
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
  billDiscount?: Discount | null;
  customAdjustments?: Adjustment[];
  loyaltyRedemptions?: SessionLoyaltyRedemption[];
  // Refund receipt support
  receiptId?: string;
  parentReceiptId?: string;
  isRefund?: boolean;
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

  action: "SESSION_STARTED" | "SESSION_VOIDED" | "SESSION_VERIFIED" | "SESSION_AUDIT_FLAGGED" | "SESSION_AUDIT_CLEARED" | "DISCOUNT_APPLIED" | "DISCOUNT_EDITED" | "DISCOUNT_REMOVED" | "BILL_DISCOUNT_APPLIED" | "BILL_DISCOUNT_REMOVED" | "CUSTOM_CHARGE_ADDED" | "CUSTOM_CHARGE_REMOVED" | "MARK_FREE" | "UNMARK_FREE" | "VOID_TICKETS" | "UNVOID" | "PRICE_OVERRIDE" | "PAYMENT_COMPLETED" | "edit_line" | "PACKAGE_QTY_OVERRIDE_SET" | "PACKAGE_QTY_RESYNC_APPROVED_CHANGE" | "RECEIPT_DELETED" | "RECEIPT_EDITED" | "RECEIPT_VOIDED" | "ADDON_ADDED" | "REFILL_ADDED" | "GUEST_COUNT_REQUESTED" | "GUEST_COUNT_APPROVED" | "GUEST_COUNT_REJECTED" | "PACKAGE_CHANGE_REQUESTED" | "PACKAGE_CHANGE_APPROVED" | "PACKAGE_CHANGE_REJECTED" | "TICKET_SERVED" | "TICKET_CANCELLED" | "TICKET_BATCH_SERVED" | "TICKET_REMAINING_CANCELLED" | "CUSTOMER_PARTICIPANT_JOINED" | "CUSTOMER_PARTICIPANT_REJOINED" | "CUSTOMER_PARTICIPANT_REVOKED" | "CUSTOMER_PARTICIPANTS_RESET" | "CUSTOMER_REQUEST_CREATED" | "CUSTOMER_REQUEST_COMPLETED";

  actorUid: string;
  actorRole?: string | null;
  actorName?: string | null;

  // Device-local server profile (present on server-page writes)
  serverProfileId?: string | null;
  serverProfileName?: string | null;

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
  tableDisplayName?: string | null;

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
    severity?: "low" | "medium" | "high";
    
    serverCount?: number;
    finalCount?: number;

    // Customer participant fields
    participantId?: string;
    slotNumber?: number;
    joinMethod?: "qr" | "pin";
    revokedCount?: number;

    // Customer request fields
    requestId?: string;
    text?: string;
    type?: string;
    responseMs?: number;
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

export type DailyContext = {
  dayId: string; // YYYYMMDD
  holiday?: {
    name: string;
    loggedByUid: string;
    loggedAt: Timestamp;
  } | null;
  isPayday?: {
    value: boolean;
    loggedByUid: string;
    loggedAt: Timestamp;
  } | null;
};

export type SalesForecast = {
  date: string; // YYYY-MM-DD
  projectedSales: number;
  actualSales?: number;
  accuracy?: number;
  confidence?: 'high' | 'medium' | 'low';
  createdAt: Timestamp;
};

export type ReceiptSession = {
    id: string;
    tableNumber?: string;
    customer?: { name?: string };
    customerName?: string | null;
    sessionMode: 'package_dinein' | 'alacarte';
    guestCountFinal?: number;
    paymentSummary: any;
    closedAt: any;
    startedByUid: string;
    verifiedByUid?: string;
    cashierName?: string;
};

export type ReceiptSettings = {
    businessName: string;
    branchName: string;
    address: string;
    contact: string;
    tin?: string;
    vatType?: "VAT" | "NON_VAT";
    logoUrl?: string | null;
    showLogo?: boolean;
    logoWidthPct?: number;
    footerText?: string;
    showCashierName: boolean;
    showTableOrCustomer: boolean;
    showItemNotes: boolean;
    showDiscountBreakdown: boolean;
    showChargeBreakdown: boolean;
    paperWidth: "58mm" | "80mm";
    receiptNoFormat?: string;
    autoPrintAfterPayment: boolean;
    fontSize: number;
    fontFamily: string;
};

export type ReceiptData = {
    session: ReceiptSession;
    lines?: SessionBillLine[];
    payments: any[];
    settings: ReceiptSettings;
    store?: Store;
    receiptCreatedAt?: any;
    createdByUsername?: string;
    receiptNumber?: string;
    analytics?: any;
};
