
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

export type BillableItem = {
  id: string;
  type: "package" | "addon";
  source: "auto" | "manual" | "kitchenticket";
  addonId?: string;
  itemName: string;
  qty: number;
  unitPrice: number;
  lineDiscountType: "percentage" | "fixed";
  lineDiscountValue: number;
  isFree: boolean;
  status: OrderItemStatus;
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
  type: "fixed" | "percentage";
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
