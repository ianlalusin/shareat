
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
};

export type GListItem = {
  id: string;
  item: string;
  category: string;
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
  employmentStatus: 'Active' | 'Inactive' | 'Resigned' | 'AWOL';
  notes: string;
  picture?: string;
  encoder: string;
};

export type Product = {
  id: string;
  productName: string;
  category: string;
  barcode: string;
  unit: string;
  specialTags: string[];
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
  sellingPrice?: number | null;// for saleable items (beer, soda); null for pure raw mats

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
  taxRate: string;
  trackInventory: boolean;
  inventoryItemId?: string | null;
  alertLevel: number;
  specialTags: string[];
  productId?: string | null;
  unit: string;
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
  tableLabel: string; // The label from the Table document (e.g., "1", "2A")
  status: 'Active' | 'Completed' | 'Cancelled';
  guestCount: number;
  customerName: string;
  address?: string;
  tin?: string;
  orderTimestamp: Timestamp; // Firestore ServerTimestamp, marks the start of the 2-hour limit
  completedTimestamp?: Timestamp; // Firestore ServerTimestamp
  totalAmount: number;
  notes?: string;
  initialFlavors: string[];
  packageName: string;
};

// Represents only PAID items for an order
export type OrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  menuName: string;
  quantity: number;
  priceAtOrder: number;
  targetStation?: 'Hot' | 'Cold';
  timestamp: Timestamp; // Firestore ServerTimestamp
  servedTimestamp?: Timestamp;
  status: 'Pending' | 'Served' | 'Cancelled';
  isRefill: boolean;
};

// Represents FREE refill items, kept separate for operational analysis
export type RefillItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  menuName: string;
  quantity: number;
  targetStation?: 'Hot' | 'Cold';
  timestamp: Timestamp; // Firestore ServerTimestamp
  servedTimestamp?: Timestamp;
  status: 'Pending' | 'Served' | 'Cancelled';
};

export type OrderTransaction = {
  id: string;
  orderId: string;
  type: 'Payment' | 'Discount' | 'Charge';
  amount: number;
  method?: string; // e.g., 'Cash', 'Card', or from G.List for MOP
  notes?: string;
  timestamp: Timestamp; 
};

    
