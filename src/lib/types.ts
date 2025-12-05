
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
  openingDate?: string;
};

export type GListItem = {
  id: string;
  item: string;
  category: string;
  is_active: boolean;
  storeIds: string[];
};

export type Staff = {
  id: string;
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

// This is no longer used and can be removed, but we'll keep it for now
// to avoid breaking other parts of the app that might reference it.
export type Variant = {
  id: string;
  name: string;
  cost: number;
  price: number;
  barcode: string;
  isAvailable: boolean;
};

export type MenuItem = {
  id: string;
  // Linking variants
  parentMenuId?: string; // If this is present, it's a variant.
  variantName?: string;  // e.g., "Small", "Large", "Spicy"

  // Shared properties
  category: string;
  menuName: string; // The name of the main dish, e.g., "Pizza"
  storeIds: string[];
  availability: string;
  targetStation?: 'Hot' | 'Cold';
  imageUrl?: string;
  publicDescription?: string;
  specialTags?: string[];
  isAvailable: boolean; // Each item/variant has its own availability

  // Individual properties
  cost: number;
  price: number;
  sellBy: 'unit' | 'fraction';
  barcode: string;
  trackInventory?: boolean;
  alertLevel?: number;
  taxRate?: string;
};

