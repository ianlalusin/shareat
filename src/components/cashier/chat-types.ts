export type ChatThread = {
  id: string;
  customerName?: string | null;
  phone?: string | null;
  status: "open" | "closed";
  lastMessageText?: string | null;
  lastMessageBy?: "customer" | "staff" | null;
  lastMessageAtClientMs?: number | null;
  createdAtClientMs: number;
  unreadForStaff?: number;
};

export type ChatMessage = {
  id: string;
  sender: "customer" | "staff";
  text: string;
  staffName?: string | null;
  createdAtClientMs: number;
};
