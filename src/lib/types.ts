
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
  birthday: string;
  dateHired: string;
  position: string;
  rate: number;
  employmentStatus: 'Active' | 'Inactive' | 'Resigned' | 'AWOL';
  notes: string;
  picture?: string;
  encoder: string;
};

export type MenuItem = {
  id: string;
  menuName: string;
  category: string;
  soldBy: 'unit' | 'fraction';
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
  alertLevel: number;
  specialTags: string[];
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
  tableLabel: string;
  status: 'Active' | 'Completed' | 'Cancelled';
  guestCount: number;
  orderTimestamp: any; // Firestore ServerTimestamp
  completedTimestamp?: any; // Firestore ServerTimestamp
  totalAmount: number;
  notes?: string;
};

export type OrderItem = {
  id: string;
  orderId: string;
  menuItemId: string;
  menuName: string;
  quantity: number;
  priceAtOrder: number;
  isRefill: boolean;
  targetStation?: 'Hot' | 'Cold';
  timestamp: any; // Firestore ServerTimestamp
};

export type OrderTransaction = {
  id: string;
  orderId: string;
  type: 'Payment' | 'Discount' | 'Charge';
  amount: number;
  method?: string; // e.g., 'Cash', 'Card', or from G.List
  notes?: string;
  timestamp: any; // Firestore ServerTimestamp
};
