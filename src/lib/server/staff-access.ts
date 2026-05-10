import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

type AllowedRole = "admin" | "manager" | "cashier" | "kitchen" | "server";

type StaffAccess = {
  uid: string;
  role: string;
  assignedStoreIds: string[];
  isPlatformAdmin: boolean;
};

export async function requireStaffStoreAccess(
  db: Firestore,
  decoded: DecodedIdToken,
  storeId: string,
  allowedRoles: AllowedRole[]
): Promise<StaffAccess> {
  const uid = decoded.uid;
  if (!uid) {
    throw new Error("Invalid token.");
  }

  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) {
    throw new Error("Not a staff member.");
  }

  const staffData = staffSnap.data() as any;
  const role = String(staffData?.role || "");
  const status = String(staffData?.status || "");
  const assignedStoreIds = Array.isArray(staffData?.assignedStoreIds)
    ? staffData.assignedStoreIds.map((value: unknown) => String(value)).filter(Boolean)
    : [];
  const isPlatformAdmin = decoded.platformAdmin === true || role === "admin";

  if (status !== "active") {
    throw new Error("Staff not active.");
  }
  if (!allowedRoles.includes(role as AllowedRole) && !isPlatformAdmin) {
    throw new Error("You are not allowed to access this route.");
  }
  if (!isPlatformAdmin && !assignedStoreIds.includes(storeId)) {
    throw new Error("No access to this store.");
  }

  return { uid, role, assignedStoreIds, isPlatformAdmin };
}
