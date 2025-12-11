

import type { Timestamp } from 'firebase/firestore';

export type Store = {
  id: string;
  storeName: string;
  type: 'resto' | 'kiosk';
  contactNo: string;
  email: string;
  logo?: string;
  address: string;
  description: string;
  status: 'Active' | 'Inactive';
  tags: string[];
  mopAccepted: string[];
  openingDate?: string;
  tableLocations: string[];
  tinNumber?: string;
};

export type CollectionItem = {
  id: string;
  item: string;
  category: string;
  subCategory?: string;
  is_active: boolean;
  storeIds: string[];
};

export type Staff = {
  id:string;
  assignedStore: string;
  fullName: string;
  address: string;
  email: string;
  contactNo: string;
  birthday: string | Timestamp;
  dateHired: string | Timestamp;
  position: string;
  rate: number;
  employmentStatus: 'Active' | 'Inactive' | 'Resigned' | 'AWOL' | 'Probation';
  notes: string;
  picture?: string;
  encoder: string;
  authUid?: string | null;
  duplicateOf?: string | null;
  lastLoginAt?: Timestamp;
};

export type User = {
    id: string; // authUid
    staffId?: string | null;
    email: string;
    displayName: string;
    role: "cashier" | "kitchen" | "refill" | "manager" | "admin" | "owner" | "staff";
    status: "active" | "disabled" | "pending";
    createdAt: Timestamp;
    lastLoginAt: Timestamp;
}

export type PendingAccount = {
    id: string;
    uid: string; // The user's auth UID
    type: 'new_account' | 'profile_update';
    email: string;
    fullName: string;
    phone?: string;
    birthday?: string;
    address?: string;
    picture?: string;
    status: "pending" | "approved" | "rejected";
    createdAt: Timestamp;
    expiresAt: Timestamp;
    notes?: string;
    // For updates
    staffId?: string; // The staff record this update targets
    updates?: Partial<Pick<Staff, 'fullName' | 'contactNo' | 'address' | 'birthday' | 'picture'>>;
    rejectionReason?: string;
    approvedBy?: string;
    rejectedBy?: string;
}


export type Product = {
  id: string;
  productName: string;
  category: string;
  barcode: string;
  unit: string;
  isActive: boolean;
  defaultCost: number;
  defaultPrice: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastUpdatedBy: string;
  imageUrl?: string;
};

export type InventoryItemType = "raw" | "saleable";

export interface InventoryItem {
  id: string;                  // Firestore doc id
  storeId: string;             // which branch (same as in your other collections)

  itemType: InventoryItemType; // "raw" = raw mats, "saleable" = beer/soda/etc.

  name: string;                // human readable name: "Pork Belly Sliced", "Coke 1.5L"
  sku: string;                 // internal code or barcode (for now)
  category: string;            // "Meat", "Vegetable", "Beverage", etc.
  unit: string;                // canonical: "kg", "g", "L", "ml", "pc", "bottle", "can", "pack"

  currentQty: number;          // current on-hand stock (in `unit`)
  reorderPoint: number;        // when <= this → low stock
  criticalPoint: number;       // when <= this → critical stock

  costPerUnit: number;         // base cost per unit for this store

  isPerishable: boolean;       // if true, watch expiry
  expiryDate?: Timestamp | null;

  trackInventory: boolean;     // if this should be included in stock alerts / dashboards

  productId: string | null;   // Link to the master product

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type MenuItem = {
  id: string;
  menuName: string;
  category: string;
  cost: number;
  price: number;
  barcode: string;
  isAvailable: boolean;
  storeId: string;
  availability: string;
  imageUrl?: string;
  publicDescription?: string;
  targetStation?: 'Hot' | 'Cold';
  taxRate?: string;
  trackInventory: boolean;
  inventoryItemId?: string | null;
  alertLevel: number;
  productId?: string | null;
  unit: string;
  is_refillable: boolean;
  allowed_refills: string[];
  sortOrder?: number;
  flavors?: string[];
};

export type Table = {
    id: string;
    tableName: string;
    storeId: string;
    status: 'Available' | 'Occupied' | 'Reserved' | 'Inactive';
    activeOrderId?: string;
    resetCounter: number;
    location: string;
};

export type Order = {
  id: string;
  storeId: string;
  tableId?: string;
  tableName?: string;
  status: 'Active' | 'Completed' | 'Cancelled';
  guestCount: number;
  customerName: string;
  address?: string;
  tin?: string;
  orderTimestamp: Timestamp;
  completedTimestamp?: Timestamp;
  totalAmount: number;
  notes?: string;
  packageName: string;
  selectedFlavors: string[];
  kitchenNote?: string;
  priority?: 'normal' | 'rush';
  isServerConfirmed: boolean;
  receiptDetails?: {
    receiptNumber: string;
    cashierName: string;
    cashierUid?: string | null;
    printedAt?: Timestamp;
    totalAmount?: number;
    totalPaid?: number;
    change?: number;
  };
  totalPaid?: number;
  change?: number;
  paymentSummary?: { method: string; amount: number }[];
};

export type OrderItem = {
  id: string;
  orderId: string;
  storeId: string;
  menuItemId: string;
  menuName: string;
  quantity: number;
  priceAtOrder: number;
  targetStation?: 'Hot' | 'Cold';
  timestamp: Timestamp;
  servedTimestamp?: Timestamp;
  status: 'Pending' | 'Served' | 'Cancelled';
  isRefill: boolean;
  sourceTag?: 'initial' | 'refill' | 'cashier' | 'addon';
  kitchenNote?: string;
  priority?: 'normal' | 'rush';
  servedAt?: Timestamp;
  servedBy?: string;
};

export type RefillItem = {
  id: string;
  orderId: string;
  storeId: string;
  menuItemId: string;
  menuName: string;
  quantity: number;
  targetStation?: 'Hot' | 'Cold';
  timestamp: Timestamp;
  servedTimestamp?: Timestamp;
  status: 'Pending' | 'Served' | 'Cancelled';
  kitchenNote?: string;
  priority?: 'normal' | 'rush';
  servedAt?: Timestamp;
  servedBy?: string;
};

export type OrderTransaction = {
  id: string;
  orderId: string;
  storeId: string;
  type: 'Payment' | 'Discount' | 'Charge';
  amount: number;
  method?: string;
  notes?: string;
  timestamp: Timestamp; 
  cashierUid?: string | null;
};

export type OrderUpdateLog = {
    id: string;
    orderId: string;
    storeId: string;
    timestamp: Timestamp;
    updatedByUid: string;
    updatedByName: string;
    reason: string;
    changes: {
        field: 'guestCount' | 'packageName' | 'totalAmount';
        oldValue: string | number;
        newValue: string | number;
    }[];
};

export type PendingOrderUpdate = {
    id: string;
    orderId: string;
    storeId: string;
    initiatedByUid: string;
    initiatedByName: string;
    initiatedAt: Timestamp;
    status: 'pending' | 'approved' | 'rejected';
    type: 'guestCount' | 'package';
    reason: string;
    changes: {
        field: 'guestCount' | 'packageName';
        oldValue: string | number;
        newValue: string | number;
    }[];
};

export type ReceiptSettings = {
    id: string; // Same as storeId
    showLogo: boolean;
    receiptNumberPrefix: string;
    nextReceiptNumber: number;
    showStoreAddress: boolean;
    showContactInfo: boolean;
    showTinNumber: boolean;
    showCustomerDetails: boolean;
    footerNotes?: string;
    printerType: 'thermal' | 'standard';
    paperWidth: '58mm' | '80mm';
};
