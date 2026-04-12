import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

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

export async function GET(req: Request) {
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
  if (!staffSnap.exists || staffSnap.data()?.status !== "active") {
    return bad("Not active staff.", 403);
  }

  const url = new URL(req.url);
  const phone = normalizePhone(url.searchParams.get("phone") || "");
  if (!phone) return bad("Invalid phone number.");

  const customerSnap = await db.doc(`customers/${phone}`).get();
  if (!customerSnap.exists) return NextResponse.json({ ok: true, found: false });

  const c = customerSnap.data() as any;

  const ledgerSnap = await db
    .collection(`customers/${phone}/pointsLedger`)
    .orderBy("createdAt", "desc")
    .limit(20)
    .get();

  const ledger = ledgerSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      type: data.type,
      points: data.points,
      amount: data.amount,
      storeId: data.storeId,
      sessionId: data.sessionId,
      createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
    };
  });

  return NextResponse.json({
    ok: true,
    found: true,
    customer: {
      phone: c.phone,
      name: c.name,
      address: c.address,
      email: c.email ?? null,
      bday: c.bday,
      pointsBalance: c.pointsBalance ?? 0,
      createdAtMs: c.createdAt?.toMillis ? c.createdAt.toMillis() : null,
      passwordResetAtMs: c.passwordResetAt?.toMillis ? c.passwordResetAt.toMillis() : null,
    },
    ledger,
  });
}
