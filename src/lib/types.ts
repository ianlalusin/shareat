
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
  days: string[];
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: any;
  updatedAt: any;
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
    createdByUid: string;
    createdAt: any;
    preparedByUid?: string | null;
    preparedAt?: any | null;
    servedByUid?: string | null;
    servedAt?: any | null;
    cancelledByUid?: string | null;
    cancelledAt?: any | null;
    initialFlavorIds?: string[];
    initialFlavorNames?: string[];
    sessionMode?: 'package_dinein' | 'alacarte';
    customerName?: string | null;
};

export type StoreAddon = {
    id: string; // The document ID, which is the Product ID
    name: string; // Denormalized name
    price: number;
    isEnabled: boolean;
    sortOrder: number;
    isArchived: boolean;
    category?: string;
    uom?: string;
    kitchenLocationId?: string | null;
    kitchenLocationName?: string | null;
    imageUrl?: string;
    barcode?: string;
};

export type PendingSession = {
  id: string;
  storeId: string;
  tableNumber: string;
  packageName: string;
  status: 'pending_verification' | 'active' | 'closed';
  sessionMode: 'package_dinein' | 'alacarte';
  customerName?: string | null;
  customer?: { name?: string | null, tin?: string | null, address?: string | null };
  isPaid?: boolean;
  packageOfferingId: string;
  initialFlavorIds?: string[];
  startedAt: any;
  // Guest Count Model
  guestCountCashierInitial: number;
  guestCountServerVerified: number | null;
  guestCountFinal: number | null;
  guestCountVerifyLocked: boolean;
  // Change Request Models
  guestCountChange?: { status: string };
  packageChange?: { status: string };
};

export type BillableItem = {
  id: string;
  type: "package" | "addon" | "refill";
  source: "auto" | "manual" | "kitchenticket";
  addonId?: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  lineDiscountType: "percent" | "fixed";
  lineDiscountValue: number;
  isFree: boolean;
  status?: OrderItemStatus; // Optional as it comes from a separate doc
  createdAt: any; // Ideally Timestamp, but any for flexibility
  updatedAt: any;
  createdByUid: string;
};

export type GroupedBillableItem = {
    key: string;
    isGrouped: boolean;
    totalQty: number;
    servedQty: number;
    pendingQty: number;
    cancelledQty: number;
    ticketIds: string[];
    createdAtMin: any | null; // Timestamp
} & Omit<BillableItem, 'id' | 'qty'>;

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
  vatType?: "VAT" | "NON_VAT";
  isActive: boolean;
  openingDate?: Timestamp | null;
  contactNumber?: string;
  email?: string;
  createdAt: any;
  updatedAt: any;
};

    
