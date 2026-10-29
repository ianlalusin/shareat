import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import bcrypt from "bcryptjs";
import { FieldValue } from "firebase-admin/firestore";
import { writeLoyaltyLog } from "@/lib/server/loyaltyLog";
import { normalizePhone } from "@/lib/phone";
import { PRESENCE_WINDOW_MS, resolvePhonePresence } from "@/lib/server/loyaltyPresence";
import { writeCustomerPasswordHash } from "@/lib/server/customer-secrets";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }

  const uid = decoded.uid;
  if (!uid) return bad("Invalid token.", 401);

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);

  const isAdminOrManager =
    staffData.role === "admin" || staffData.role === "manager" || decoded.platformAdmin === true;
  if (!isAdminOrManager) return bad("Admin or manager role required.", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const phone = normalizePhone(String(body.phone || ""));
  if (!phone) return bad("Invalid phone number.");

  const customNewPassword = body.newPassword ? String(body.newPassword) : null;
  if (customNewPassword !== null && customNewPassword.length < 6) {
    return bad("Password must be at least 6 characters.");
  }

  const customerRef = db.doc(`customers/${phone}`);
  const snap = await customerRef.get();
  if (!snap.exists) return bad("Customer not found.", 404);

  // Same scope gate as /api/loyalty/lookup. Guarding only the lookup would
  // leave this route as the bypass: a manager could POST an arbitrary phone
  // and reset a customer they were never allowed to see.
  const isPlatformAdmin = decoded.platformAdmin === true || staffData.role === "admin";
  if (!isPlatformAdmin) {
    const assignedStoreIds: string[] = Array.isArray(staffData.assignedStoreIds)
      ? staffData.assignedStoreIds.map(String)
      : [];
    const storeId = String(body.storeId || "").trim();
    if (!storeId) return bad("storeId is required.");
    if (!assignedStoreIds.includes(storeId)) {
      return bad("You are not assigned to this store.", 403);
    }
    const presence = await resolvePhonePresence(storeId, phone);
    if (!presence) {
      // Name the window, not the store: the record is global, it is the
      // *recency* of the customer's activity here that fails the gate.
      const hours = PRESENCE_WINDOW_MS / 3600000;
      return bad(
        `This customer has had no activity at your store in the last ${hours} ` +
          `hour${hours === 1 ? "" : "s"}, so their record is out of scope here. ` +
          `Link them to their table or ask an admin to reset it.`,
        403
      );
    }
  }

  const newPassword = customNewPassword || generateTempPassword();
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Secret doc + (during the transition) the legacy profile field, atomically.
  // See src/lib/server/customer-secrets.ts (audit B05).
  await writeCustomerPasswordHash(db, phone, passwordHash, {
    passwordResetAt: FieldValue.serverTimestamp(),
    passwordResetByUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Audit log (individual doc + daily projection)
  await writeLoyaltyLog({
    type: "password_reset",
    phone,
    customerName: snap.data()?.name || "",
    actorUid: uid,
  });

  return NextResponse.json({
    ok: true,
    phone,
    newPassword,
  });
}
