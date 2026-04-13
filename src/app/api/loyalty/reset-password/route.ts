import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import bcrypt from "bcryptjs";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("63")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("09")) return `+63${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) return `+63${digits}`;
  return null;
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
    decoded = await getAdminAuth().verifyIdToken(match[1]);
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

  const newPassword = customNewPassword || generateTempPassword();
  const passwordHash = await bcrypt.hash(newPassword, 10);

  await customerRef.update({
    passwordHash,
    passwordResetAt: FieldValue.serverTimestamp(),
    passwordResetByUid: uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Audit log
  await db.collection("loyaltyLogs").add({
    type: "password_reset",
    phone,
    customerName: snap.data()?.name || "",
    actorUid: uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({
    ok: true,
    phone,
    newPassword,
  });
}
