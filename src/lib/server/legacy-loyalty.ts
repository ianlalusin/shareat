import { FieldValue } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
// Relative, not `@/lib/phone`: `scripts/seed-legacy-loyalty.ts` imports this
// module under tsx, outside Next's module resolution, so the `@/` alias would
// not resolve there. A relative hop keeps a single normaliser instead of a
// second copy of the PH rules that could drift from the Hub's.
import { normalizePhone } from "../phone";

/**
 * Legacy (pre-Hub) loyalty customers, parked for in-person claiming.
 *
 * Backstory: ~106 people earned points on an old Google Sheet that predates the
 * loyalty Hub. They are seeded here as `parked` rows. A walk-in is verified by
 * staff against name + government ID, then the row is marked `claimed` against
 * the phone number of their (already existing) Hub loyalty card.
 *
 * NO POINTS MOVE IN THIS MODULE. `claimLegacyCustomer` records who verified
 * whom and returns `transferPoints` purely as a number for the owner to key
 * into the existing Hub transfer. Nothing here writes `customers/*` or any
 * points ledger.
 *
 * Deliberately free of `server-only` and of `@/` path aliases: the API routes
 * and `scripts/seed-legacy-loyalty.ts` both import it, and the script runs
 * under tsx outside Next's module resolution.
 */

export const LEGACY_COLLECTION = "legacyLoyaltyCustomers";

/** Firestore caps a write batch at 500; 400 leaves headroom. */
const SEED_BATCH = 400;

/** The fields that come straight from the exported claim list. */
export type LegacyLoyaltySeedRow = {
  id: string;
  name: string;
  altNames: string[];
  legacyIds: string[];
  ledgerRows: number;
  firstVisitMs: number;
  lastVisitMs: number;
  legacyPoints: number;
  /** Points the customer is owed after conversion — what the owner transfers. */
  newPoints: number;
  emails: string[];
  warnings: string[];
};

export type LegacyUnclaimEvent = {
  unclaimedAtMs: number;
  unclaimedByUid: string;
};

export type LegacyLoyaltyCustomer = LegacyLoyaltySeedRow & {
  status: "parked" | "claimed";
  claimedAtMs?: number;
  claimedPhone?: string;
  claimedByUid?: string;
  claimedByName?: string;
  claimNote?: string;
  idVerified?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  /** Provenance string from the export header: source sheet + row count + span. */
  source: string;
  /** Append-only trail of un-claims, so a reversal is never silent. */
  history?: LegacyUnclaimEvent[];
};

/**
 * Carries the status the route should answer with, so routes map an error to a
 * response code instead of pattern-matching on the message.
 */
export class LegacyLoyaltyError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "LegacyLoyaltyError";
    this.httpStatus = httpStatus;
  }
}

export type SeedResult = {
  /** Rows that had no doc yet. */
  created: number;
  /** Rows whose doc existed and was still parked, so the seed fields were refreshed. */
  updated: number;
  /** Rows already claimed by a human — left completely untouched. */
  skippedClaimed: number;
};

function seedFieldsOf(row: LegacyLoyaltySeedRow): LegacyLoyaltySeedRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    altNames: Array.isArray(row.altNames) ? row.altNames.map(String) : [],
    legacyIds: Array.isArray(row.legacyIds) ? row.legacyIds.map(String) : [],
    ledgerRows: Number(row.ledgerRows) || 0,
    firstVisitMs: Number(row.firstVisitMs) || 0,
    lastVisitMs: Number(row.lastVisitMs) || 0,
    legacyPoints: Number(row.legacyPoints) || 0,
    newPoints: Number(row.newPoints) || 0,
    emails: Array.isArray(row.emails) ? row.emails.map(String) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
  };
}

/**
 * Idempotent seed. Re-running with a corrected export refreshes every parked
 * row and cannot resurrect, re-park or overwrite a row a staff member has
 * already claimed — the claim is the only human-entered state in here, so it
 * outranks anything the file says.
 */
export async function seedLegacyCustomers(
  db: Firestore,
  customers: LegacyLoyaltySeedRow[],
  opts: { source: string; write: boolean; nowMs?: number },
): Promise<SeedResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const result: SeedResult = { created: 0, updated: 0, skippedClaimed: 0 };

  const pending: Array<{ path: string; data: Record<string, unknown> }> = [];

  for (const raw of customers) {
    const id = String(raw?.id ?? "").trim();
    if (!id) throw new LegacyLoyaltyError("Seed row is missing an id.", 400);

    const path = `${LEGACY_COLLECTION}/${id}`;
    const snap = await db.doc(path).get();
    const existing = snap.exists ? (snap.data() as Partial<LegacyLoyaltyCustomer>) : null;

    if (existing && existing.status === "claimed") {
      result.skippedClaimed += 1;
      continue;
    }

    const fields: Record<string, unknown> = {
      ...seedFieldsOf(raw),
      status: "parked",
      source: opts.source,
      updatedAtMs: nowMs,
    };
    // createdAtMs is write-once: a re-seed must not restate when we first
    // parked the row.
    if (!existing) fields.createdAtMs = nowMs;

    if (existing) result.updated += 1;
    else result.created += 1;

    pending.push({ path, data: fields });
  }

  if (!opts.write) return result;

  for (let i = 0; i < pending.length; i += SEED_BATCH) {
    const slice = pending.slice(i, i + SEED_BATCH);
    const batch = db.batch();
    for (const p of slice) batch.set(db.doc(p.path), p.data, { merge: true });
    await batch.commit();
  }

  return result;
}

export type ClaimInput = {
  id: string;
  phone: string;
  idVerified: boolean;
  note?: string;
  actorUid: string;
  actorName: string;
};

export type ClaimResult = {
  row: LegacyLoyaltyCustomer;
  /** What the owner should move via the existing Hub transfer. Not moved here. */
  transferPoints: number;
  /** Name on the Hub loyalty card at `claimedPhone`, for a last eyeball check. */
  customerName: string;
};

/**
 * Mark a parked legacy row as claimed by the holder of a Hub loyalty card.
 *
 * Order of checks is deliberate: the cheap refusals (ID not verified,
 * unparseable phone, no loyalty card) resolve before the transaction opens, so
 * the only thing the transaction arbitrates is the genuine race — two staff
 * claiming the same row at once.
 */
export async function claimLegacyCustomer(
  db: Firestore,
  input: ClaimInput,
): Promise<ClaimResult> {
  const id = String(input?.id ?? "").trim();
  if (!id) throw new LegacyLoyaltyError("Missing legacy customer id.", 400);

  if (input?.idVerified !== true) {
    throw new LegacyLoyaltyError(
      "Government ID must be checked before claiming. Tick the ID-verified box.",
      400,
    );
  }

  const phone = normalizePhone(String(input?.phone ?? ""));
  if (!phone || !phone.startsWith("+63")) {
    throw new LegacyLoyaltyError("Invalid phone number. Use a PH mobile number.", 400);
  }

  const customerSnap = await db.doc(`customers/${phone}`).get();
  if (!customerSnap.exists) {
    throw new LegacyLoyaltyError(
      "No loyalty card at that number yet — ask the customer to sign up in the Hub first.",
      404,
    );
  }
  const customerName = String((customerSnap.data() as any)?.name ?? "");

  const nowMs = Date.now();
  const note = String(input?.note ?? "").trim();
  const ref = db.doc(`${LEGACY_COLLECTION}/${id}`);

  const row = await db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new LegacyLoyaltyError("Legacy customer not found.", 404);

    const current = snap.data() as LegacyLoyaltyCustomer;
    if (current.status !== "parked") {
      const who = current.claimedByName || current.claimedByUid || "another staff member";
      const when = current.claimedAtMs
        ? new Date(current.claimedAtMs).toISOString()
        : "an earlier shift";
      throw new LegacyLoyaltyError(
        `Already claimed by ${who} on ${when}. Check with them before re-issuing points.`,
        409,
      );
    }

    const claimFields = {
      status: "claimed" as const,
      claimedAtMs: nowMs,
      claimedPhone: phone,
      claimedByUid: String(input.actorUid ?? ""),
      claimedByName: String(input.actorName ?? ""),
      claimNote: note,
      idVerified: true,
      updatedAtMs: nowMs,
    };
    tx.update(ref, claimFields);

    return { ...current, ...claimFields } as LegacyLoyaltyCustomer;
  });

  return { row, transferPoints: Number(row.newPoints) || 0, customerName };
}

/**
 * Undo a claim (wrong person, wrong phone, staff mis-tap). Reverts to parked
 * and clears the claim fields, but appends to `history` so the reversal itself
 * stays on the record — a row that has bounced between states twice is a
 * verification problem worth being able to see.
 */
export async function unclaimLegacyCustomer(
  db: Firestore,
  input: { id: string; actorUid: string },
): Promise<LegacyLoyaltyCustomer> {
  const id = String(input?.id ?? "").trim();
  if (!id) throw new LegacyLoyaltyError("Missing legacy customer id.", 400);

  const nowMs = Date.now();
  const ref = db.doc(`${LEGACY_COLLECTION}/${id}`);

  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new LegacyLoyaltyError("Legacy customer not found.", 404);

    const current = snap.data() as LegacyLoyaltyCustomer;
    if (current.status !== "claimed") {
      throw new LegacyLoyaltyError("That row is not claimed, so there is nothing to undo.", 409);
    }

    const event: LegacyUnclaimEvent = {
      unclaimedAtMs: nowMs,
      unclaimedByUid: String(input.actorUid ?? ""),
    };

    tx.update(ref, {
      status: "parked",
      claimedAtMs: FieldValue.delete(),
      claimedPhone: FieldValue.delete(),
      claimedByUid: FieldValue.delete(),
      claimedByName: FieldValue.delete(),
      claimNote: FieldValue.delete(),
      idVerified: FieldValue.delete(),
      updatedAtMs: nowMs,
      history: FieldValue.arrayUnion(event),
    });

    const next: LegacyLoyaltyCustomer = {
      ...current,
      status: "parked",
      updatedAtMs: nowMs,
      history: [...(Array.isArray(current.history) ? current.history : []), event],
    };
    delete next.claimedAtMs;
    delete next.claimedPhone;
    delete next.claimedByUid;
    delete next.claimedByName;
    delete next.claimNote;
    delete next.idVerified;
    return next;
  });
}

export type LegacySummary = {
  parked: number;
  claimed: number;
  /** Points still sitting unclaimed — the outstanding liability. */
  pointsRemaining: number;
  /** Points already handed to a verified walk-in. */
  pointsClaimed: number;
};

/** Pure: counts and point totals for the staff panel header. */
export function summarizeLegacy(rows: LegacyLoyaltyCustomer[]): LegacySummary {
  const summary: LegacySummary = { parked: 0, claimed: 0, pointsRemaining: 0, pointsClaimed: 0 };
  for (const row of rows) {
    const points = Number(row?.newPoints) || 0;
    if (row?.status === "claimed") {
      summary.claimed += 1;
      summary.pointsClaimed += points;
    } else {
      summary.parked += 1;
      summary.pointsRemaining += points;
    }
  }
  return summary;
}
