import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

type AllowedRole = "admin" | "manager" | "cashier" | "kitchen" | "server";

type ActiveStaff = {
  uid: string;
  role: string;
  displayName: string | null;
  assignedStoreIds: string[];
  isPlatformAdmin: boolean;
};

/**
 * Verifies the decoded token belongs to an active staff member (or a platform admin)
 * with one of the allowed roles. Unlike `requireStaffStoreAccess`, this does NOT
 * require store-level access — use it for global resources like catalogItems where
 * scope is handled by query params, not by staff store assignment.
 */
export async function requireActiveStaff(
  db: Firestore,
  decoded: DecodedIdToken,
  allowedRoles: AllowedRole[] = ["admin", "manager"]
): Promise<ActiveStaff> {
  const uid = decoded.uid;
  if (!uid) throw new Error("Invalid token.");

  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) throw new Error("Not a staff member.");

  const staffData = staffSnap.data() as any;
  const role = String(staffData?.role || "");
  const status = String(staffData?.status || "");
  const displayName = staffData?.displayName ?? staffData?.name ?? null;
  const assignedStoreIds = Array.isArray(staffData?.assignedStoreIds)
    ? staffData.assignedStoreIds.map((value: unknown) => String(value)).filter(Boolean)
    : [];
  const isPlatformAdmin = decoded.platformAdmin === true || role === "admin";

  if (status !== "active") throw new Error("Staff not active.");
  if (!allowedRoles.includes(role as AllowedRole) && !isPlatformAdmin) {
    throw new Error("You are not allowed to access this route.");
  }

  return { uid, role, displayName, assignedStoreIds, isPlatformAdmin };
}
