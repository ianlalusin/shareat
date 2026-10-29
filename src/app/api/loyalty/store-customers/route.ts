import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import {
  PRESENCE_WINDOW_MS,
  manilaDayId,
  resolveStorePresence,
  type StorePresence,
} from "@/lib/server/loyaltyPresence";

export const runtime = "nodejs";

const LOG_LIMIT = 200;
const ADMIN_ACCOUNT_LIMIT = 500;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type LogRow = {
  id: string;
  type: string;
  phone: string;
  customerName: string;
  actorUid: string;
  storeId: string | null;
  storeName: string | null;
  points: number | null;
  amount: number | null;
  createdAtMs: number | null;
};

/**
 * Store-scoped view of the Sharelebrator customer base.
 *
 * The /pins Customers tab used to read `customers` and `loyaltyLogs` straight
 * from the client, which showed every branch's customers to every branch.
 * Those collections are now admin-only in firestore.rules, so store-scoped
 * staff come through here and get only the customers their store is serving.
 * Admins keep the global view.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }

  const db = getAdminDb();

  let staff;
  try {
    staff = await requireActiveStaff(db, decoded, [
      "admin",
      "manager",
      "cashier",
      "kitchen",
      "server",
    ]);
  } catch (err: any) {
    return bad(err?.message || "Not active staff.", 403);
  }

  if (staff.isPlatformAdmin) {
    return NextResponse.json(await buildGlobalView(db));
  }

  const storeId = String(new URL(req.url).searchParams.get("storeId") || "").trim();
  if (!storeId) return bad("storeId is required.");
  if (!staff.assignedStoreIds.includes(storeId)) {
    return bad("You are not assigned to this store.", 403);
  }

  return NextResponse.json(await buildStoreView(db, storeId));
}

/** Admin view: unchanged global list, straight off the collections. */
async function buildGlobalView(db: FirebaseFirestore.Firestore) {
  const [accountsSnap, logsSnap, statsSnap] = await Promise.all([
    db.collection("customers").orderBy("createdAt", "desc").limit(ADMIN_ACCOUNT_LIMIT).get(),
    db.collection("loyaltyLogs").orderBy("createdAt", "desc").limit(LOG_LIMIT).get(),
    db.doc("loyaltyStats/global").get(),
  ]);

  const customers = accountsSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      phone: d.id,
      name: data.name ?? "",
      pointsBalance: Number(data.pointsBalance) || 0,
      createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
      presence: null as string | null,
      lastActiveAtMs: null as number | null,
      reason: null as string | null,
    };
  });

  const logs: LogRow[] = logsSnap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      type: data.type,
      phone: data.phone ?? "",
      customerName: data.customerName ?? "",
      actorUid: data.actorUid ?? "",
      storeId: data.storeId ?? null,
      storeName: data.storeName ?? null,
      points: data.points ?? null,
      amount: data.amount ?? null,
      createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
    };
  });

  const stats = statsSnap.exists ? (statsSnap.data() as any) : null;

  return {
    ok: true,
    scope: "global" as const,
    windowMinutes: PRESENCE_WINDOW_MS / 60000,
    customers,
    logs,
    stats: {
      label: "All branches",
      totalAccounts: Number(stats?.totalAccounts) || customers.length,
      totalPointsOutstanding:
        Number(stats?.totalPointsOutstanding) ||
        customers.reduce((sum, c) => sum + c.pointsBalance, 0),
    },
  };
}

/** Store view: only customers inside this store's presence window. */
async function buildStoreView(db: FirebaseFirestore.Firestore, storeId: string) {
  const nowMs = Date.now();
  const presence = await resolveStorePresence(storeId, nowMs);

  const phones = Array.from(presence.keys());
  const customers = phones.length ? await hydrate(db, presence, phones) : [];

  return {
    ok: true,
    scope: "store" as const,
    windowMinutes: PRESENCE_WINDOW_MS / 60000,
    customers,
    logs: await readStoreLogs(db, storeId, nowMs),
    stats: {
      label: "At this store",
      totalAccounts: customers.length,
      totalPointsOutstanding: customers.reduce((sum, c) => sum + c.pointsBalance, 0),
    },
  };
}

async function hydrate(
  db: FirebaseFirestore.Firestore,
  presence: Map<string, StorePresence>,
  phones: string[]
) {
  const refs = phones.map((phone) => db.doc(`customers/${phone}`));
  const snaps = await db.getAll(...refs);

  const rows = snaps
    .map((snap) => {
      // A presence signal can outlive its customer doc (deleted account, or a
      // stale session link). Drop rather than render a blank row.
      if (!snap.exists) return null;
      const data = snap.data() as any;
      const p = presence.get(snap.id)!;
      return {
        phone: snap.id,
        name: data.name ?? "",
        pointsBalance: Number(data.pointsBalance) || 0,
        createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
        presence: p.presence,
        lastActiveAtMs: p.lastActiveAtMs,
        reason: p.reason,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  // In-session first, then most recently active.
  rows.sort((a, b) => {
    if (a.presence !== b.presence) return a.presence === "active" ? -1 : 1;
    return (b.lastActiveAtMs ?? 0) - (a.lastActiveAtMs ?? 0);
  });

  return rows;
}

/**
 * This store's slice of the audit log, from the daily projections.
 *
 * Covers today and yesterday (Manila) rather than the last 200 events
 * globally, for the same reason the presence resolver uses projections: no
 * composite index required. Read from the raw projection docs so it is not
 * limited to the presence window; the log is history, not access.
 */
async function readStoreLogs(
  db: FirebaseFirestore.Firestore,
  storeId: string,
  nowMs: number
): Promise<LogRow[]> {
  const dayIds = Array.from(
    new Set([manilaDayId(nowMs - 24 * 60 * 60 * 1000), manilaDayId(nowMs)])
  );

  const rows: LogRow[] = [];

  for (const dayId of dayIds) {
    const metaSnap = await db.doc(`loyaltyLogsDaily/${dayId}_meta`).get();
    const activePart = metaSnap.exists ? Number(metaSnap.data()?.activePart ?? 0) : 0;

    for (let part = 0; part <= activePart; part++) {
      const partSnap = await db.doc(`loyaltyLogsDaily/${dayId}_${part}`).get();
      if (!partSnap.exists) continue;
      const entries: any[] = Array.isArray(partSnap.data()?.entries)
        ? partSnap.data()!.entries
        : [];
      for (const e of entries) {
        if (String(e?.storeId ?? "") !== storeId) continue;
        rows.push({
          id: String(e?.logId ?? `${dayId}_${part}_${rows.length}`),
          type: String(e?.type ?? ""),
          phone: String(e?.phone ?? ""),
          customerName: String(e?.customerName ?? ""),
          actorUid: String(e?.actorUid ?? ""),
          storeId: e?.storeId ?? null,
          storeName: e?.storeName ?? null,
          points: e?.points ?? null,
          amount: e?.amount ?? null,
          createdAtMs: Number(e?.createdAtMs) || null,
        });
      }
    }
  }

  rows.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0));
  return rows.slice(0, LOG_LIMIT);
}
