

import { Timestamp } from "firebase/firestore";

export type UserRole = 'admin' | 'manager' | 'cashier' | 'kitchen' | 'server' | 'pending';

export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
  role: UserRole;
  storeId?: string; // The store the user is currently associated with
}

export interface Session {
  user: User | null;
  loading: boolean;
}

export interface UserDocument {
    displayName: string;
    email: string;
    role: UserRole;
    storeId: string;
    photoURL?: string;
}

export type Product = {
  id: string;
  name: string;
  variant?: string;
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
  variant?: string;
  category?: string;
  subCategory?: string;
  uom: string;
  cost: number;
  sellingPrice: number;
  taxId?: string;
  isActive: boolean;
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
    preparedByUid?: string | null;
    preparedAt?: any | null;
    servedByUid?: string | null;
    servedAt?: any | null;
    servedCounted?: boolean;
    cancelledByUid?: string | null;
    cancelledAt?: any | null;
    initialFlavorIds?: string[];
    initialFlavorNames?: string[];
    sessionMode?: 'package_dinein' | 'alacarte';
    customerName?: string | null;
    sessionLabel?: string;
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
  voidedQty: number; // addons only
  createdAt: any;
  updatedAt: any;
  updatedByUid?: string | null;
  updatedByName?: string | null;
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
  tableNumber: string;
  packageName: string;
  status: 'pending_verification' | 'active' | 'closed';
  sessionMode: 'package_dinein' | 'alacarte';
  customerName?: string | null;
  isPaid?: boolean;
  packageOfferingId: string;
  initialFlavorIds?: string[];
  startedAt: Timestamp;
  // Guest Count Model
  guestCountCashierInitial: number;
  guestCountServerVerified: number | null;
  guestCountFinal: number | null;
  guestCountVerifyLocked: boolean;
  // Change Request Models
  guestCountChange?: { status: string };
  packageChange?: { status: string };
  customer?: { name?: string | null, tin?: string | null, address?: string | null };
};

export type ReceiptAnalyticsV2 = {
  v: 2;
  sessionStartedAt: any | null;
  sessionStartedAtClientMs: number | null;
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
  servedRefillsByName?: Record<string, number>;
  serveCountByType?: Record<string, number>;
  serveTimeMsTotalByType?: Record<string, number>;
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
    lines: SessionBillLine[];
    total: number;
    totalPaid: number;
    change: number;
    status: 'final' | 'void';
    receiptSeq: number;
    receiptNumber: string;
    receiptNoFormatUsed: string;
    analytics?: any | ReceiptAnalyticsV2;
}

export type StoreAddon = {
  id: string;
  name: string;
  category?: string;
  uom?: string;
  price: number;
  isEnabled: boolean;
  isArchived: boolean;
  sortOrder: number;
  kitchenLocationId: string | null;
  kitchenLocationName: string | null;
  imageUrl?: string;
  barcode?: string;
};

export type ActivityLog = {
  id: string;
  sessionId: string;
  storeId: string;

  action: "DISCOUNT_APPLIED" | "DISCOUNT_REMOVED" | "MARK_FREE" | "UNMARK_FREE" | "VOID_TICKETS" | "UNVOID" | "PRICE_OVERRIDE" | "PAYMENT_COMPLETED" | "edit_line";

  actorUid: string;
  actorRole?: string | null;
  actorName?: string | null;
  
  lineId?: string;
  
  before?: any;
  after?: any;

  reason?: string | null;
  note?: string | null;

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
