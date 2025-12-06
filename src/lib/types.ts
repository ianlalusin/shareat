
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
};
