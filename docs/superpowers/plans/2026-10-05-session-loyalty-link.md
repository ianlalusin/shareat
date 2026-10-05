# Session ↔ Sharelebrator Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cashier session cards and the bill screen show whether a session is linked to a Sharelebrator card, and a cashier can attach a card (QR scan or search) to an unlinked session before billout.

**Architecture:** Pure helpers (`src/lib/loyalty/session-link.ts`) hold phone/QR/pill/estimate logic. Two Admin-SDK routes (`link-session`, `find-customer`) delegate to testable core functions in `src/lib/server/`. UI adds `CardPill`, `LinkCardDialog`, and `SessionCardBanner`, wired into the session grid, session header and `PaymentModal`. No new Firestore fields except audit fields on the existing session docs; no rules change (writes go through Admin SDK).

**Tech Stack:** Next.js (app router, port 9003), Firebase Admin/Firestore, vitest (`src/**/*.test.ts`, node env), shadcn/ui, lucide-react, `QrScanner` (jsqr).

**Spec:** `docs/superpowers/specs/2026-10-05-session-loyalty-link-design.md`

## Global Constraints

- Add-only: a cashier can link only an open session with no `linkedCustomerPhone` and no `linkedCustomerLockedAt`; no replace/unlink.
- Phones are always normalized with `normalizePhone` (`src/lib/phone.ts`) to `+63XXXXXXXXXX`; that string is the `customers/{phone}` doc ID and the card QR payload.
- Cashier link writes `linkedCustomerPhone`, `linkedCustomerName`, `linkedByParticipantId: null`, `linkedBy: "cashier"`, `linkedByUid`, `linkedAt` on BOTH `stores/{sid}/activeSessions/{id}` and `stores/{sid}/sessions/{id}`.
- Allowed roles for both new routes: `admin`, `manager`, `cashier`, with store access via `requireStaffStoreAccess` (admin/platform admin bypass store check).
- Name search is scoped to customers with `storeVisits.{storeId}.lastVisitAtMs > 0`; exact phone/QR works for any customer. Name query min 2 chars; max 10 results.
- Card-owner pill: black background, white text, `★` first (`★ Maria Santos`). Unlinked: grey "No card". Suffix "via cashier" when `linkedBy === "cashier"`.
- Linking requires connectivity; offline shows "Linking needs an internet connection." and billout is unchanged.
- Do not touch the CUSTOMER repo, PIN TTL, or `firestore.rules`.
- Tests: `npm test` (vitest, `src/**/*.test.ts` only — component logic must live in `.ts` files to be tested). Typecheck: `npm run typecheck`. Dev server is port 9003 (`npm run dev`); stop it before `next build`.

## Review Focus

- Two cashiers link different cards to the same session at once → exactly one wins (transaction), the other gets 409.
- Cashier links a phone with a typo that has no account → 404 "No Sharelebrator account", nothing written.
- Session paid/closed between opening the dialog and confirming → 409/404, no write.
- Same card linked twice (double-tap) → second call is an idempotent success, no second write.
- QR that isn't a card (URL, EMVCo payment QR, random text) → rejected client-side without calling the API.
- Name search with `%`, regex chars or very long input → treated as plain substring, no crash.
- Customer-side link already set (diner linked on phone) → banner shows linked state and Link button is absent.

---

### Task 1: Pure helpers

**Files:**
- Create: `src/lib/loyalty/session-link.ts`
- Test: `src/lib/loyalty/session-link.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_POINTS_PER_PESO: number` (0.01)
  - `MIN_NAME_QUERY: number` (2)
  - `type CustomerQuery = {kind:"phone";phone:string}|{kind:"name";q:string}|{kind:"incomplete"}`
  - `classifyCustomerQuery(raw: string): CustomerQuery`
  - `parseCardQrPayload(payload: string): string | null`
  - `nameMatches(name: string, q: string): boolean`
  - `maskPhone(phone: string): string`
  - `estimateEarnPoints(amount: number, cfg?: {isEnabled?: boolean; pointsPerPeso?: number} | null): number`
  - `type CardPillModel = {linked:boolean;label:string;viaCashier:boolean}`
  - `cardPillModel(s: {linkedCustomerPhone?: string|null; linkedCustomerName?: string|null; linkedBy?: string|null}): CardPillModel`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loyalty/session-link.test.ts
import { describe, it, expect } from "vitest";
import {
  cardPillModel,
  classifyCustomerQuery,
  estimateEarnPoints,
  maskPhone,
  nameMatches,
  parseCardQrPayload,
} from "./session-link";

describe("classifyCustomerQuery", () => {
  it("normalizes phone shapes", () => {
    for (const raw of ["+639171234567", "09171234567", "9171234567", "0917 123 4567", "(0917) 123-4567"]) {
      expect(classifyCustomerQuery(raw)).toEqual({ kind: "phone", phone: "+639171234567" });
    }
  });
  it("treats partial digit strings as incomplete, not a name", () => {
    expect(classifyCustomerQuery("0917")).toEqual({ kind: "incomplete" });
    expect(classifyCustomerQuery("12345")).toEqual({ kind: "incomplete" });
  });
  it("treats text of 2+ chars as a name and shorter/empty as incomplete", () => {
    expect(classifyCustomerQuery("  Maria ")).toEqual({ kind: "name", q: "Maria" });
    expect(classifyCustomerQuery("M")).toEqual({ kind: "incomplete" });
    expect(classifyCustomerQuery("")).toEqual({ kind: "incomplete" });
  });
});

describe("parseCardQrPayload", () => {
  it("accepts the card QR (phone string)", () => {
    expect(parseCardQrPayload("+639171234567")).toBe("+639171234567");
    expect(parseCardQrPayload("09171234567")).toBe("+639171234567");
  });
  it("rejects URLs, payment QRs and junk", () => {
    expect(parseCardQrPayload("https://shareat.net/c/09171234567")).toBeNull();
    expect(parseCardQrPayload("00020101021228370011ph.ppmi.p2m")).toBeNull();
    expect(parseCardQrPayload("hello")).toBeNull();
    expect(parseCardQrPayload("")).toBeNull();
  });
});

describe("nameMatches", () => {
  it("is a case-insensitive plain substring match", () => {
    expect(nameMatches("Maria Santos", "mar")).toBe(true);
    expect(nameMatches("Maria Santos", "SANTOS")).toBe(true);
    expect(nameMatches("Maria Santos", "xyz")).toBe(false);
  });
  it("requires 2+ chars and treats regex/special chars literally", () => {
    expect(nameMatches("Maria Santos", "m")).toBe(false);
    expect(nameMatches("Maria Santos", ".*")).toBe(false);
    expect(nameMatches("A.* B", ".*")).toBe(true);
    expect(nameMatches("Maria", "%")).toBe(false);
  });
});

describe("maskPhone", () => {
  it("masks the middle digits", () => {
    expect(maskPhone("+639171234567")).toBe("+63 9•• ••• 4567");
  });
  it("returns empty string for invalid input", () => {
    expect(maskPhone("nope")).toBe("");
  });
});

describe("estimateEarnPoints", () => {
  it("uses the store rate, floors, defaults to 1pt/₱100", () => {
    expect(estimateEarnPoints(1250, { isEnabled: true, pointsPerPeso: 0.02 })).toBe(25);
    expect(estimateEarnPoints(1250)).toBe(12);
    expect(estimateEarnPoints(99, null)).toBe(0);
  });
  it("is 0 when loyalty is disabled or amount invalid", () => {
    expect(estimateEarnPoints(1000, { isEnabled: false, pointsPerPeso: 0.01 })).toBe(0);
    expect(estimateEarnPoints(0)).toBe(0);
    expect(estimateEarnPoints(NaN)).toBe(0);
  });
});

describe("cardPillModel", () => {
  it("unlinked", () => {
    expect(cardPillModel({})).toEqual({ linked: false, label: "No card", viaCashier: false });
    expect(cardPillModel({ linkedCustomerPhone: "  " })).toEqual({ linked: false, label: "No card", viaCashier: false });
  });
  it("linked with name", () => {
    expect(cardPillModel({ linkedCustomerPhone: "+639171234567", linkedCustomerName: "Maria Santos" }))
      .toEqual({ linked: true, label: "Maria Santos", viaCashier: false });
  });
  it("linked without name falls back to masked phone; cashier flag", () => {
    expect(cardPillModel({ linkedCustomerPhone: "+639171234567", linkedBy: "cashier" }))
      .toEqual({ linked: true, label: "+63 9•• ••• 4567", viaCashier: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loyalty/session-link.test.ts`
Expected: FAIL — cannot resolve `./session-link`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/loyalty/session-link.ts
import { normalizePhone } from "@/lib/phone";

/** Mirrors DEFAULT_POINTS_PER_PESO in src/lib/server/loyalty.ts (1 point per ₱100). */
export const DEFAULT_POINTS_PER_PESO = 0.01;
export const MIN_NAME_QUERY = 2;

export type CustomerQuery =
  | { kind: "phone"; phone: string }
  | { kind: "name"; q: string }
  | { kind: "incomplete" };

/** Digits-and-phone-punctuation only → a phone query; anything else → a name query. */
export function classifyCustomerQuery(raw: string): CustomerQuery {
  const q = String(raw ?? "").trim();
  if (!q) return { kind: "incomplete" };
  if (/^\+?[\d\s()-]+$/.test(q)) {
    const phone = normalizePhone(q);
    return phone ? { kind: "phone", phone } : { kind: "incomplete" };
  }
  return q.length >= MIN_NAME_QUERY ? { kind: "name", q } : { kind: "incomplete" };
}

/** The card QR is the bare phone string; anything else (URL, EMVCo, text) is not a card. */
export function parseCardQrPayload(payload: string): string | null {
  const c = classifyCustomerQuery(payload);
  return c.kind === "phone" ? c.phone : null;
}

export function nameMatches(name: string, q: string): boolean {
  const needle = String(q ?? "").trim().toLowerCase();
  if (needle.length < MIN_NAME_QUERY) return false;
  return String(name ?? "").toLowerCase().includes(needle);
}

export function maskPhone(phone: string): string {
  const n = normalizePhone(phone);
  if (!n) return "";
  const d = n.slice(3); // 10 digits, 9XXXXXXXXX
  return `+63 ${d[0]}•• ••• ${d.slice(-4)}`;
}

/** Same math as writeLoyaltyEarn: floor(amount × rate). 0 when disabled/invalid. */
export function estimateEarnPoints(
  amount: number,
  cfg?: { isEnabled?: boolean; pointsPerPeso?: number } | null,
): number {
  if (cfg && cfg.isEnabled === false) return 0;
  if (!(amount > 0)) return 0;
  const rate = Number(cfg?.pointsPerPeso) || DEFAULT_POINTS_PER_PESO;
  return Math.floor(amount * rate);
}

export type CardPillModel = { linked: boolean; label: string; viaCashier: boolean };

export function cardPillModel(s: {
  linkedCustomerPhone?: string | null;
  linkedCustomerName?: string | null;
  linkedBy?: string | null;
}): CardPillModel {
  const phone = String(s.linkedCustomerPhone ?? "").trim();
  if (!phone) return { linked: false, label: "No card", viaCashier: false };
  const name = String(s.linkedCustomerName ?? "").trim();
  return {
    linked: true,
    label: name || maskPhone(phone) || "Linked",
    viaCashier: s.linkedBy === "cashier",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loyalty/session-link.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty/session-link.ts src/lib/loyalty/session-link.test.ts
git commit -m "feat(loyalty): session-link helpers (query classify, QR parse, pill model, earn estimate)"
```

---

### Task 2: Server core — `linkCardToSession`

**Files:**
- Create: `src/lib/server/session-link.ts`
- Test: `src/lib/server/session-link.test.ts`

**Interfaces:**
- Consumes: none from earlier tasks (phone arrives already normalized).
- Produces:
  - `type LinkResult = {ok:true;phone:string;name:string;pointsBalance:number;alreadyLinked:boolean} | {ok:false;status:404|409;error:string}`
  - `linkCardToSession(db: Firestore, args: {storeId:string; sessionId:string; phone:string; staffUid:string}): Promise<LinkResult>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/session-link.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

import { linkCardToSession } from "./session-link";

const STORE = "storeA";
const SID = "sess1";
const PHONE = "+639171234567";
const ACTIVE = `stores/${STORE}/activeSessions/${SID}`;
const SESSION = `stores/${STORE}/sessions/${SID}`;
const CUSTOMER = `customers/${PHONE}`;

let docs: Record<string, any>;
let writes: Array<{ path: string; data: any }>;

function fakeDb() {
  const ref = (path: string) => ({ path });
  return {
    doc: ref,
    runTransaction: async (fn: (tx: any) => Promise<any>) =>
      fn({
        get: async (r: any) => ({ exists: docs[r.path] !== undefined, data: () => docs[r.path] }),
        update: (r: any, data: any) => {
          writes.push({ path: r.path, data });
          docs[r.path] = { ...docs[r.path], ...data };
        },
      }),
  } as any;
}

const args = { storeId: STORE, sessionId: SID, phone: PHONE, staffUid: "cashier_1" };

beforeEach(() => {
  writes = [];
  docs = {
    [ACTIVE]: { status: "active", isPaid: false },
    [SESSION]: { status: "active" },
    [CUSTOMER]: { name: "Maria Santos", pointsBalance: 120 },
  };
});

describe("linkCardToSession", () => {
  it("links an unlinked open session and writes both docs", async () => {
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toEqual({ ok: true, phone: PHONE, name: "Maria Santos", pointsBalance: 120, alreadyLinked: false });
    expect(writes.map((w) => w.path).sort()).toEqual([ACTIVE, SESSION].sort());
    for (const w of writes) {
      expect(w.data).toMatchObject({
        linkedCustomerPhone: PHONE,
        linkedCustomerName: "Maria Santos",
        linkedByParticipantId: null,
        linkedBy: "cashier",
        linkedByUid: "cashier_1",
      });
      expect(w.data.linkedAt).toEqual({ __sentinel: "serverTimestamp" });
    }
  });

  it("is idempotent for the same phone (no second write)", async () => {
    await linkCardToSession(fakeDb(), args);
    writes = [];
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toMatchObject({ ok: true, alreadyLinked: true });
    expect(writes).toHaveLength(0);
  });

  it("409 when already linked to a different card, and writes nothing", async () => {
    docs[ACTIVE].linkedCustomerPhone = "+639998887777";
    docs[ACTIVE].linkedCustomerName = "Jose Reyes";
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toEqual({ ok: false, status: 409, error: "Session already linked to Jose Reyes." });
    expect(writes).toHaveLength(0);
  });

  it("409 when the session is locked or paid", async () => {
    docs[ACTIVE].linkedCustomerLockedAt = { seconds: 1 };
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 409 });
    docs[ACTIVE] = { isPaid: true };
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 409 });
    expect(writes).toHaveLength(0);
  });

  it("404 when the session is gone (closed projection deleted)", async () => {
    delete docs[ACTIVE];
    expect(await linkCardToSession(fakeDb(), args)).toMatchObject({ ok: false, status: 404 });
    expect(writes).toHaveLength(0);
  });

  it("404 when no customer account exists for the phone", async () => {
    delete docs[CUSTOMER];
    expect(await linkCardToSession(fakeDb(), args)).toEqual({
      ok: false, status: 404, error: "No Sharelebrator account for that number.",
    });
    expect(writes).toHaveLength(0);
  });

  it("still links when the sessions doc is missing", async () => {
    delete docs[SESSION];
    const r = await linkCardToSession(fakeDb(), args);
    expect(r).toMatchObject({ ok: true });
    expect(writes.map((w) => w.path)).toEqual([ACTIVE]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/session-link.test.ts`
Expected: FAIL — cannot resolve `./session-link`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/session-link.ts
import "server-only";

import { FieldValue, type Firestore } from "firebase-admin/firestore";

export type LinkResult =
  | { ok: true; phone: string; name: string; pointsBalance: number; alreadyLinked: boolean }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Cashier-initiated Sharelebrator link. Add-only: refuses sessions that are
 * paid/locked or already linked to a different card. Runs in a transaction so
 * two cashiers linking different cards at once cannot both win.
 *
 * `phone` must already be normalized (+63XXXXXXXXXX). Existence of the
 * activeSessions projection is the "session is open" signal — billout and
 * void delete it.
 */
export async function linkCardToSession(
  db: Firestore,
  args: { storeId: string; sessionId: string; phone: string; staffUid: string },
): Promise<LinkResult> {
  const { storeId, sessionId, phone, staffUid } = args;
  const activeRef = db.doc(`stores/${storeId}/activeSessions/${sessionId}`);
  const sessionRef = db.doc(`stores/${storeId}/sessions/${sessionId}`);
  const customerRef = db.doc(`customers/${phone}`);

  return db.runTransaction(async (tx): Promise<LinkResult> => {
    const [activeSnap, sessionSnap, customerSnap] = await Promise.all([
      tx.get(activeRef),
      tx.get(sessionRef),
      tx.get(customerRef),
    ]);

    if (!activeSnap.exists) {
      return { ok: false, status: 404, error: "Session not found or already closed." };
    }
    const active = activeSnap.data() as any;
    if (active?.isPaid === true || active?.linkedCustomerLockedAt) {
      return { ok: false, status: 409, error: "Session is closed to linking." };
    }
    if (!customerSnap.exists) {
      return { ok: false, status: 404, error: "No Sharelebrator account for that number." };
    }
    const customer = customerSnap.data() as any;
    const name = String(customer?.name ?? "");
    const pointsBalance = Number(customer?.pointsBalance) || 0;

    const existing = String(active?.linkedCustomerPhone ?? "");
    if (existing === phone) {
      return { ok: true, phone, name, pointsBalance, alreadyLinked: true };
    }
    if (existing) {
      const who = String(active?.linkedCustomerName ?? "") || existing;
      return { ok: false, status: 409, error: `Session already linked to ${who}.` };
    }

    const fields = {
      linkedCustomerPhone: phone,
      linkedCustomerName: name,
      linkedByParticipantId: null,
      linkedBy: "cashier",
      linkedByUid: staffUid,
      linkedAt: FieldValue.serverTimestamp(),
    };
    tx.update(activeRef, fields);
    if (sessionSnap.exists) tx.update(sessionRef, fields);

    return { ok: true, phone, name, pointsBalance, alreadyLinked: false };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/session-link.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/session-link.ts src/lib/server/session-link.test.ts
git commit -m "feat(loyalty): transactional cashier link of a card to an open session"
```

---

### Task 3: Server core — `findCustomers`

**Files:**
- Create: `src/lib/server/find-customer.ts`
- Test: `src/lib/server/find-customer.test.ts`

**Interfaces:**
- Consumes: `classifyCustomerQuery`, `nameMatches` from Task 1.
- Produces:
  - `type CustomerHit = {phone:string; name:string; pointsBalance:number}`
  - `type FindCustomersResult = {kind:"phone"|"name"|"incomplete"; results: CustomerHit[]}`
  - `NAME_SCAN_LIMIT = 500`, `MAX_RESULTS = 10`
  - `findCustomers(db: Firestore, args:{storeId:string; q:string}): Promise<FindCustomersResult>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/find-customer.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldPath: class {
    parts: string[];
    constructor(...parts: string[]) { this.parts = parts; }
  },
}));

import { findCustomers, MAX_RESULTS } from "./find-customer";

const STORE = "storeA";

function custDoc(phone: string, name: string, pts: number, lastVisit?: number) {
  return {
    id: phone,
    data: () => ({
      name,
      pointsBalance: pts,
      ...(lastVisit ? { storeVisits: { [STORE]: { visits: 1, lastVisitAtMs: lastVisit } } } : {}),
    }),
  };
}

function fakeDb(all: ReturnType<typeof custDoc>[]) {
  let scanned = 0;
  const db: any = {
    doc: (path: string) => ({
      get: async () => {
        const phone = path.replace("customers/", "");
        const d = all.find((x) => x.id === phone);
        return { exists: !!d, id: phone, data: () => d?.data() };
      },
    }),
    collection: (_: string) => {
      let limitN = Infinity;
      const q: any = {
        where: (fp: any, op: string, v: number) => {
          expect(fp.parts).toEqual(["storeVisits", STORE, "lastVisitAtMs"]);
          expect(op).toBe(">");
          expect(v).toBe(0);
          return q;
        },
        orderBy: (fp: any, dir: string) => {
          expect(fp.parts).toEqual(["storeVisits", STORE, "lastVisitAtMs"]);
          expect(dir).toBe("desc");
          return q;
        },
        limit: (n: number) => { limitN = n; return q; },
        get: async () => {
          const rows = all
            .filter((d) => (d.data() as any).storeVisits?.[STORE]?.lastVisitAtMs > 0)
            .sort((a, b) => (b.data() as any).storeVisits[STORE].lastVisitAtMs - (a.data() as any).storeVisits[STORE].lastVisitAtMs)
            .slice(0, limitN);
          scanned = rows.length;
          return { docs: rows };
        },
      };
      return q;
    },
  };
  return { db, scanned: () => scanned };
}

describe("findCustomers", () => {
  it("exact phone returns that customer even if they never visited this store", async () => {
    const { db } = fakeDb([custDoc("+639171234567", "Maria Santos", 50)]);
    const r = await findCustomers(db, { storeId: STORE, q: "0917 123 4567" });
    expect(r).toEqual({ kind: "phone", results: [{ phone: "+639171234567", name: "Maria Santos", pointsBalance: 50 }] });
  });

  it("exact phone with no account returns empty results", async () => {
    const { db } = fakeDb([]);
    const r = await findCustomers(db, { storeId: STORE, q: "09171234567" });
    expect(r).toEqual({ kind: "phone", results: [] });
  });

  it("name search only sees customers who visited this store, case-insensitive", async () => {
    const { db } = fakeDb([
      custDoc("+639170000001", "Maria Santos", 10, 200),
      custDoc("+639170000002", "Marites Cruz", 20, 100),
      custDoc("+639170000003", "Maria Other-Branch", 30), // never visited storeA
    ]);
    const r = await findCustomers(db, { storeId: STORE, q: "mari" });
    expect(r.kind).toBe("name");
    expect(r.results.map((x) => x.name)).toEqual(["Maria Santos", "Marites Cruz"]);
  });

  it("caps results at MAX_RESULTS", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      custDoc(`+63917000${String(1000 + i)}`, `Ana ${String(i).padStart(2, "0")}`, 0, 1000 + i));
    const { db } = fakeDb(rows);
    const r = await findCustomers(db, { storeId: STORE, q: "ana" });
    expect(r.results).toHaveLength(MAX_RESULTS);
  });

  it("incomplete query does no reads and returns nothing", async () => {
    const { db } = fakeDb([]);
    db.doc = () => { throw new Error("should not read"); };
    db.collection = () => { throw new Error("should not read"); };
    expect(await findCustomers(db, { storeId: STORE, q: "a" })).toEqual({ kind: "incomplete", results: [] });
    expect(await findCustomers(db, { storeId: STORE, q: "0917" })).toEqual({ kind: "incomplete", results: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/find-customer.test.ts`
Expected: FAIL — cannot resolve `./find-customer`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/server/find-customer.ts
import "server-only";

import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { classifyCustomerQuery, nameMatches } from "@/lib/loyalty/session-link";

export type CustomerHit = { phone: string; name: string; pointsBalance: number };
export type FindCustomersResult = {
  kind: "phone" | "name" | "incomplete";
  results: CustomerHit[];
};

/** Most-recent visitors first; bounds the scan so a big store can't blow up a request. */
export const NAME_SCAN_LIMIT = 500;
export const MAX_RESULTS = 10;

function toHit(id: string, data: any): CustomerHit {
  return {
    phone: id,
    name: String(data?.name ?? ""),
    pointsBalance: Number(data?.pointsBalance) || 0,
  };
}

/**
 * Customer lookup for the cashier "link card" flow.
 *  - phone query → exact doc get, any branch (typing a full number proves possession).
 *  - name query  → only customers who have visited THIS store (customers are
 *    store-scoped by design; see api/loyalty/store-customers), recent first.
 */
export async function findCustomers(
  db: Firestore,
  args: { storeId: string; q: string },
): Promise<FindCustomersResult> {
  const query = classifyCustomerQuery(args.q);

  if (query.kind === "incomplete") return { kind: "incomplete", results: [] };

  if (query.kind === "phone") {
    const snap = await db.doc(`customers/${query.phone}`).get();
    return { kind: "phone", results: snap.exists ? [toHit(snap.id, snap.data())] : [] };
  }

  const lastVisit = new FieldPath("storeVisits", args.storeId, "lastVisitAtMs");
  const snap = await db
    .collection("customers")
    .where(lastVisit, ">", 0)
    .orderBy(lastVisit, "desc")
    .limit(NAME_SCAN_LIMIT)
    .get();

  const results = snap.docs
    .map((d) => toHit(d.id, d.data()))
    .filter((c) => nameMatches(c.name, query.q))
    .slice(0, MAX_RESULTS);

  return { kind: "name", results };
}
```

Note: the test's "exact phone" case expects `snap.id`; the real Admin `DocumentSnapshot` has `.id`. The test's fake `get()` returns `id` accordingly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/find-customer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the index if Firestore requires one**

Single-field ascending/descending indexes on nested map fields are automatic; no `firestore.indexes.json` change is expected. If the first real call logs a "requires an index" error in Task 8, add the exemption/index it names and note it in the final report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/find-customer.ts src/lib/server/find-customer.test.ts
git commit -m "feat(loyalty): store-scoped customer finder for cashier card linking"
```

---

### Task 4: API routes

**Files:**
- Create: `src/app/api/loyalty/link-session/route.ts`
- Create: `src/app/api/loyalty/find-customer/route.ts`
- Test: `src/app/api/loyalty/link-session/route.test.ts`
- Test: `src/app/api/loyalty/find-customer/route.test.ts`

**Interfaces:**
- Consumes: `linkCardToSession`, `LinkResult` (Task 2); `findCustomers` (Task 3); `normalizePhone`; `requireStaffStoreAccess` (`src/lib/server/staff-access.ts`).
- Produces (HTTP):
  - `POST /api/loyalty/link-session` body `{storeId, sessionId, phone}` → `200 {ok:true, phone, name, pointsBalance, alreadyLinked}` | `{ok:false,error}` with 400/401/403/404/409.
  - `GET /api/loyalty/find-customer?storeId=&q=` → `200 {ok:true, kind, results:[{phone,name,pointsBalance}]}` | `{ok:false,error}`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/loyalty/link-session/route.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: (storeId: string, roles: string[]) => Promise<any>;
const linkMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "cashier_1" }) }),
  getAdminDb: () => ({}),
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl(storeId, roles);
  },
}));
vi.mock("@/lib/server/session-link", () => ({ linkCardToSession: (...a: any[]) => linkMock(...a) }));

import { POST } from "./route";

function req(body: any, auth: string | null = "Bearer t") {
  return new Request("http://localhost/api/loyalty/link-session", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}
const good = { storeId: "storeA", sessionId: "s1", phone: "0917 123 4567" };

beforeEach(() => {
  lastRoles = undefined;
  linkMock.mockReset();
  accessImpl = async () => ({ uid: "cashier_1", role: "cashier", assignedStoreIds: ["storeA"], isPlatformAdmin: false });
});

describe("POST /api/loyalty/link-session", () => {
  it("401 without bearer token", async () => {
    expect((await POST(req(good, null))).status).toBe(401);
  });
  it("400 on missing ids or invalid phone", async () => {
    expect((await POST(req({ ...good, sessionId: "" }))).status).toBe(400);
    expect((await POST(req({ ...good, phone: "0917" }))).status).toBe(400);
    expect(linkMock).not.toHaveBeenCalled();
  });
  it("only admin/manager/cashier are accepted; denial → 403 and no write", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(linkMock).not.toHaveBeenCalled();
  });
  it("passes the normalized phone and staff uid to the core and returns its result", async () => {
    linkMock.mockResolvedValue({ ok: true, phone: "+639171234567", name: "Maria", pointsBalance: 5, alreadyLinked: false });
    const res = await POST(req(good));
    expect(res.status).toBe(200);
    expect(linkMock).toHaveBeenCalledWith(expect.anything(), {
      storeId: "storeA", sessionId: "s1", phone: "+639171234567", staffUid: "cashier_1",
    });
    expect(await res.json()).toEqual({ ok: true, phone: "+639171234567", name: "Maria", pointsBalance: 5, alreadyLinked: false });
  });
  it("maps core failures to their status", async () => {
    linkMock.mockResolvedValue({ ok: false, status: 409, error: "Session already linked to Jose." });
    const res = await POST(req(good));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "Session already linked to Jose." });
  });
});
```

```ts
// src/app/api/loyalty/find-customer/route.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

let lastRoles: string[] | undefined;
let accessImpl: (storeId: string, roles: string[]) => Promise<any>;
const findMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: "cashier_1" }) }),
  getAdminDb: () => ({}),
}));
vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _d: any, storeId: string, roles: string[]) => {
    lastRoles = roles;
    return accessImpl(storeId, roles);
  },
}));
vi.mock("@/lib/server/find-customer", () => ({ findCustomers: (...a: any[]) => findMock(...a) }));

import { GET } from "./route";

const get = (qs: string, auth: string | null = "Bearer t") =>
  new Request(`http://localhost/api/loyalty/find-customer?${qs}`, {
    headers: auth ? { Authorization: auth } : {},
  });

beforeEach(() => {
  lastRoles = undefined;
  findMock.mockReset();
  accessImpl = async () => ({ uid: "cashier_1", role: "cashier", assignedStoreIds: ["storeA"], isPlatformAdmin: false });
});

describe("GET /api/loyalty/find-customer", () => {
  it("401 without bearer token", async () => {
    expect((await GET(get("storeId=storeA&q=maria", null))).status).toBe(401);
  });
  it("400 without storeId", async () => {
    expect((await GET(get("q=maria"))).status).toBe(400);
  });
  it("kitchen/server style denial → 403, role list is admin/manager/cashier", async () => {
    accessImpl = async () => { throw new Error("You are not allowed to access this route."); };
    expect((await GET(get("storeId=storeA&q=maria"))).status).toBe(403);
    expect(lastRoles).toEqual(["admin", "manager", "cashier"]);
    expect(findMock).not.toHaveBeenCalled();
  });
  it("returns the finder result", async () => {
    findMock.mockResolvedValue({ kind: "name", results: [{ phone: "+639171234567", name: "Maria", pointsBalance: 5 }] });
    const res = await GET(get("storeId=storeA&q=maria"));
    expect(res.status).toBe(200);
    expect(findMock).toHaveBeenCalledWith(expect.anything(), { storeId: "storeA", q: "maria" });
    expect(await res.json()).toEqual({
      ok: true, kind: "name", results: [{ phone: "+639171234567", name: "Maria", pointsBalance: 5 }],
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/loyalty/link-session src/app/api/loyalty/find-customer`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write minimal implementations**

```ts
// src/app/api/loyalty/link-session/route.ts
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { linkCardToSession } from "@/lib/server/session-link";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * Cashier attaches a Sharelebrator card to an open, unlinked session (for
 * diners who did not link on their own phone). Add-only — see
 * docs/superpowers/specs/2026-10-05-session-loyalty-link-design.md.
 */
export async function POST(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const storeId = String(body?.storeId || "").trim();
  const sessionId = String(body?.sessionId || "").trim();
  if (!storeId || !sessionId) return bad("storeId and sessionId are required.");

  const phone = normalizePhone(String(body?.phone || ""));
  if (!phone) return bad("Enter a valid PH mobile number.");

  const db = getAdminDb();
  let staff;
  try {
    staff = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (err: any) {
    return bad(err?.message || "Not allowed.", 403);
  }

  const result = await linkCardToSession(db, { storeId, sessionId, phone, staffUid: staff.uid });
  if (!result.ok) return bad(result.error, result.status);

  return NextResponse.json({
    ok: true,
    phone: result.phone,
    name: result.name,
    pointsBalance: result.pointsBalance,
    alreadyLinked: result.alreadyLinked,
  });
}
```

```ts
// src/app/api/loyalty/find-customer/route.ts
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { findCustomers } from "@/lib/server/find-customer";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/** Customer finder for the cashier "link card" dialog. Phone = exact; name = this store's visitors only. */
export async function GET(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  const url = new URL(req.url);
  const storeId = String(url.searchParams.get("storeId") || "").trim();
  const q = String(url.searchParams.get("q") || "");
  if (!storeId) return bad("storeId is required.");

  const db = getAdminDb();
  try {
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
  } catch (err: any) {
    return bad(err?.message || "Not allowed.", 403);
  }

  const { kind, results } = await findCustomers(db, { storeId, q });
  return NextResponse.json({ ok: true, kind, results });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/loyalty/link-session src/app/api/loyalty/find-customer`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/loyalty/link-session src/app/api/loyalty/find-customer
git commit -m "feat(loyalty): link-session and find-customer routes for cashiers"
```

---

### Task 5: Types, `CardPill`, session-card pills

**Files:**
- Modify: `src/lib/types.ts:1103-1107` (`SharelebratorLink`)
- Create: `src/components/cashier/CardPill.tsx`
- Modify: `src/components/cashier/active-sessions-grid.tsx` (type at 16-41, card body at 147-153, state/handlers at 86-97, render at 203-211)

**Interfaces:**
- Consumes: `cardPillModel` (Task 1).
- Produces:
  - `CardPill({ session, onLinkClick?, className? })` — `session: {linkedCustomerPhone?; linkedCustomerName?; linkedBy?}`; when unlinked and `onLinkClick` is provided the "No card" pill is a button that calls it with the click event.
  - `ActiveSession` gains `linkedCustomerPhone?: string|null; linkedCustomerName?: string|null; linkedBy?: string|null`.

No unit test (component; logic is covered by Task 1). Verified in Task 8.

- [ ] **Step 1: Extend the link type**

In `src/lib/types.ts`, replace the `SharelebratorLink` block with:

```ts
export type SharelebratorLink = {
  linkedCustomerPhone?: string | null;
  linkedCustomerName?: string | null;
  linkedCustomerLockedAt?: any; // Timestamp when session closed
  /** Set when a cashier (not the diner) attached the card. Absent for diner-linked sessions. */
  linkedBy?: "cashier" | null;
  linkedByUid?: string | null;
  linkedAt?: any;
};
```

- [ ] **Step 2: Create `CardPill`**

```tsx
// src/components/cashier/CardPill.tsx
"use client";

import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardPillModel } from "@/lib/loyalty/session-link";

type PillSession = {
  linkedCustomerPhone?: string | null;
  linkedCustomerName?: string | null;
  linkedBy?: string | null;
};

/**
 * Sharelebrator card status for a session. Linked = black pill, white text,
 * ★ first. Unlinked = grey "No card"; becomes a button when `onLinkClick` is
 * given (cashier can attach a card).
 */
export function CardPill({
  session,
  onLinkClick,
  className,
}: {
  session: PillSession;
  onLinkClick?: (e: React.MouseEvent) => void;
  className?: string;
}) {
  const m = cardPillModel(session);

  if (m.linked) {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full bg-black px-2 py-0.5 text-[11px] font-semibold text-white dark:ring-1 dark:ring-white/40",
          className,
        )}
        title={m.viaCashier ? "Linked by cashier" : "Linked by customer"}
      >
        <span aria-hidden className="shrink-0">★</span>
        <span className="truncate">{m.label}</span>
        {m.viaCashier && <span className="shrink-0 text-[9px] font-normal text-white/70">via cashier</span>}
      </span>
    );
  }

  const base =
    "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground";
  if (!onLinkClick) return <span className={cn(base, className)}>{m.label}</span>;
  return (
    <button
      type="button"
      onClick={onLinkClick}
      className={cn(base, "hover:bg-muted/70 hover:text-foreground", className)}
      title="Link a Sharelebrator card"
    >
      <Link2 className="h-3 w-3" /> {m.label}
    </button>
  );
}
```

- [ ] **Step 3: Add fields to `ActiveSession` and pills to the card**

In `active-sessions-grid.tsx`:

Add imports (top, with the others):

```tsx
import { UserRound } from "lucide-react";
import { CardPill } from "./CardPill";
import { LinkCardDialog } from "./LinkCardDialog";
```
(`UserRound` can be merged into the existing lucide import line.) `LinkCardDialog` is created in Task 6; if executing Task 5 alone, add the import and the dialog render in Task 6 Step 4 instead and skip the `LinkCardDialog` lines below.

Add to the `ActiveSession` type (after `hasDiscounts?`):

```tsx
    linkedCustomerPhone?: string | null;
    linkedCustomerName?: string | null;
    linkedBy?: string | null;
```

In `ActiveSessionsGrid`, after the `voidingSession` state add:

```tsx
    const [linkingSession, setLinkingSession] = useState<ActiveSession | null>(null);
    const canLink = appUser?.role === 'admin' || appUser?.role === 'manager' || appUser?.role === 'cashier';
```

In the map body, after `const isPending = ...;` add:

```tsx
                        const guestName = !isAlaCarte ? (session.customer?.name || session.customerName || '').trim() : '';
```

Insert between `</CardHeader>` (line 153) and `<CardContent ...>` (line 154):

```tsx
                                <div className="px-6 pb-2 flex flex-wrap items-center gap-1.5">
                                    {guestName && (
                                        <Badge variant="outline" className="gap-1 text-[11px] px-2 py-0 font-medium max-w-full">
                                            <UserRound className="h-3 w-3 shrink-0" />
                                            <span className="truncate">{guestName}</span>
                                        </Badge>
                                    )}
                                    <CardPill
                                        session={session}
                                        onLinkClick={canLink && !isPending ? (e) => { e.stopPropagation(); setLinkingSession(session); } : undefined}
                                    />
                                </div>
```

After the `VoidSessionDialog` block (before the closing `</>`), add:

```tsx
            {linkingSession && (
                <LinkCardDialog
                    open={!!linkingSession}
                    onOpenChange={(v) => { if (!v) setLinkingSession(null); }}
                    storeId={storeId}
                    sessionId={linkingSession.id}
                    sessionLabel={linkingSession.tableDisplayName || `Table ${linkingSession.tableNumber}`}
                />
            )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (if `LinkCardDialog` is not yet created, expect only the unresolved import — resolved in Task 6).

- [ ] **Step 5: Commit** (after Task 6 if the import was added here; otherwise now)

```bash
git add src/lib/types.ts src/components/cashier/CardPill.tsx src/components/cashier/active-sessions-grid.tsx
git commit -m "feat(cashier): card-owner and guest pills on active session cards"
```

---

### Task 6: `LinkCardDialog`

**Files:**
- Create: `src/components/cashier/LinkCardDialog.tsx`

**Interfaces:**
- Consumes: `parseCardQrPayload`, `classifyCustomerQuery`, `maskPhone` (Task 1); `/api/loyalty/find-customer`, `/api/loyalty/link-session` (Task 4); `QrScanner` (`onResult(payload)`, `onCancel()`); `useAuthContext().user`; `useOnlineStatus`; `useToast`; `useDebounce`.
- Produces: `LinkCardDialog({ open, onOpenChange, storeId, sessionId, sessionLabel?, onLinked? })` — `onLinked?: (r:{phone:string;name:string}) => void`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/cashier/LinkCardDialog.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ScanLine, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrScanner } from "@/components/qr-wallet/QrScanner";
import { useAuthContext } from "@/context/auth-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { classifyCustomerQuery, maskPhone, parseCardQrPayload } from "@/lib/loyalty/session-link";

type Hit = { phone: string; name: string; pointsBalance: number };

export function LinkCardDialog({
  open,
  onOpenChange,
  storeId,
  sessionId,
  sessionLabel,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  sessionId: string;
  sessionLabel?: string;
  onLinked?: (r: { phone: string; name: string }) => void;
}) {
  const { user } = useAuthContext();
  const isOnline = useOnlineStatus();
  const { toast } = useToast();

  const [tab, setTab] = useState<"scan" | "search">("scan");
  const [scannerKey, setScannerKey] = useState(0);
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Hit[]>([]);
  const [candidate, setCandidate] = useState<Hit | null>(null);
  const [linking, setLinking] = useState(false);

  const api = useCallback(
    async (url: string, init?: RequestInit) => {
      if (!user) throw new Error("Not signed in.");
      const token = await user.getIdToken();
      return fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
      });
    },
    [user],
  );

  const find = useCallback(
    async (q: string): Promise<Hit[]> => {
      const res = await api(`/api/loyalty/find-customer?storeId=${encodeURIComponent(storeId)}&q=${encodeURIComponent(q)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Search failed.");
      return Array.isArray(data.results) ? data.results : [];
    },
    [api, storeId],
  );

  // Debounced typeahead for the Search tab.
  useEffect(() => {
    if (!open || tab !== "search" || !isOnline) return;
    if (classifyCustomerQuery(debounced).kind === "incomplete") {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    find(debounced)
      .then((r) => { if (!cancelled) setResults(r); })
      .catch((e) => { if (!cancelled) toast({ variant: "destructive", title: "Search failed", description: e?.message }); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [debounced, open, tab, isOnline, find, toast]);

  const handleScan = useCallback(
    async (payload: string) => {
      const phone = parseCardQrPayload(payload);
      if (!phone) {
        toast({ variant: "destructive", title: "Not a Sharelebrator card", description: "That QR is not a loyalty card. Try again or search instead." });
        setScannerKey((k) => k + 1); // remount scanner to resume scanning
        return;
      }
      try {
        const hits = await find(phone);
        if (hits.length === 0) {
          toast({ variant: "destructive", title: "No account found", description: "No Sharelebrator account for that number." });
          setScannerKey((k) => k + 1);
          return;
        }
        setCandidate(hits[0]);
      } catch (e: any) {
        toast({ variant: "destructive", title: "Lookup failed", description: e?.message });
        setScannerKey((k) => k + 1);
      }
    },
    [find, toast],
  );

  const confirmLink = async () => {
    if (!candidate) return;
    setLinking(true);
    try {
      const res = await api("/api/loyalty/link-session", {
        method: "POST",
        body: JSON.stringify({ storeId, sessionId, phone: candidate.phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not link card", description: data?.error || "Something went wrong." });
        if (res.status === 409 || res.status === 404) setCandidate(null);
        return;
      }
      toast({ title: "Card linked", description: `${data.name || candidate.name} will earn points on this bill.` });
      onLinked?.({ phone: data.phone, name: data.name });
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not link card", description: e?.message || "Network error." });
    } finally {
      setLinking(false);
    }
  };

  // Reset when closed so a reopened dialog never shows a stale candidate.
  useEffect(() => {
    if (!open) {
      setCandidate(null);
      setQuery("");
      setResults([]);
      setTab("scan");
      setScannerKey((k) => k + 1);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!linking) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Sharelebrator card</DialogTitle>
          <DialogDescription>
            {sessionLabel ? `${sessionLabel} — ` : ""}scan the customer&apos;s card QR or look them up.
          </DialogDescription>
        </DialogHeader>

        {!isOnline ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Linking needs an internet connection.</p>
        ) : candidate ? (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 text-center space-y-1">
              <p className="text-lg font-semibold">★ {candidate.name || "Customer"}</p>
              <p className="text-sm text-muted-foreground">{maskPhone(candidate.phone)}</p>
              <p className="text-sm">{candidate.pointsBalance.toLocaleString("en-US")} points</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setCandidate(null); setScannerKey((k) => k + 1); }} disabled={linking}>
                Back
              </Button>
              <Button className="flex-1" onClick={confirmLink} disabled={linking}>
                {linking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Link to this bill
              </Button>
            </div>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "scan" | "search")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan"><ScanLine className="mr-2 h-4 w-4" /> Scan QR</TabsTrigger>
              <TabsTrigger value="search"><Search className="mr-2 h-4 w-4" /> Search</TabsTrigger>
            </TabsList>
            <TabsContent value="scan" className="pt-3">
              {open && tab === "scan" && (
                <QrScanner key={scannerKey} onResult={handleScan} onCancel={() => setTab("search")} />
              )}
            </TabsContent>
            <TabsContent value="search" className="pt-3 space-y-3">
              <Input
                autoFocus
                placeholder="Phone number or name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Full phone number finds any customer. Names search this store&apos;s past customers only.
              </p>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {searching && <p className="text-sm text-muted-foreground py-2 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></p>}
                {!searching && results.length === 0 && classifyCustomerQuery(query).kind !== "incomplete" && (
                  <p className="text-sm text-muted-foreground py-2 text-center">No matches.</p>
                )}
                {results.map((r) => (
                  <button
                    key={r.phone}
                    type="button"
                    onClick={() => setCandidate(r)}
                    className="w-full flex items-center justify-between rounded-md border px-3 py-2 text-left hover:bg-muted/50"
                  >
                    <span className="font-medium truncate">{r.name || "Customer"}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{maskPhone(r.phone)}</span>
                  </button>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashier/LinkCardDialog.tsx src/components/cashier/active-sessions-grid.tsx
git commit -m "feat(cashier): link-card dialog (QR scan + phone/name search)"
```

---

### Task 7: Session header + bill-screen banner

**Files:**
- Modify: `src/components/cashier/session-header.tsx`
- Modify: `src/components/cashier/session-detail-view.tsx:722-726` (header props) and its imports/state
- Create: `src/components/cashier/SessionCardBanner.tsx`
- Modify: `src/components/cashier/payment-modal.tsx` (imports; inside `paymentForm`, directly after `</DialogHeader>` at line 520)

**Interfaces:**
- Consumes: `CardPill`, `LinkCardDialog` (Tasks 5–6), `cardPillModel`/`estimateEarnPoints` (Task 1), `Store.loyaltyConfig`.
- Produces: `SessionCardBanner({ storeId, sessionId, grandTotal, loyaltyConfig, canLink })`; `SessionHeader` gains optional props `linkedCustomerPhone?`, `linkedBy?`, `onLinkCard?`.

- [ ] **Step 1: `SessionHeader` — use `CardPill` and add a Link action**

Replace the `Sparkles` import and the linked-badge block. New imports:

```tsx
import { CardPill } from "./CardPill";
```
(remove the `Sparkles` import). Extend props interface `session` with:

```tsx
    linkedCustomerPhone?: string | null;
    linkedBy?: string | null;
```
and add a second prop to `SessionHeaderProps`:

```tsx
  onLinkCard?: () => void;
```
Change the signature to `export function SessionHeader({ session, onLinkCard }: SessionHeaderProps)` and replace the `{session.linkedCustomerName && (...)}` block with:

```tsx
            <CardPill
              session={session}
              onLinkClick={onLinkCard ? (e) => { e.stopPropagation(); onLinkCard(); } : undefined}
            />
```

- [ ] **Step 2: `session-detail-view.tsx` — pass link data and mount the dialog**

Add imports near the other cashier imports:

```tsx
import { LinkCardDialog } from "@/components/cashier/LinkCardDialog";
```

Add state next to the other `useState`s in the component body:

```tsx
  const [isLinkCardOpen, setIsLinkCardOpen] = useState(false);
  const canLinkCard = appUser?.role === "admin" || appUser?.role === "manager" || appUser?.role === "cashier";
```

Replace the `<SessionHeader session={{...}} />` call (lines 722-726) with:

```tsx
        <SessionHeader
          session={{
            id: session.id, tableNumber: session.tableNumber, guestCount: session.guestCountFinal || 0,
            packageName: session.packageSnapshot?.name ?? "N/A", sessionMode: session.sessionMode, customerName: session.customer?.name ?? session.customerName,
            linkedCustomerName: (session as any).linkedCustomerName ?? null,
            linkedCustomerPhone: (session as any).linkedCustomerPhone ?? null,
            linkedBy: (session as any).linkedBy ?? null,
          }}
          onLinkCard={canLinkCard && !session.isPaid && !(session as any).linkedCustomerLockedAt ? () => setIsLinkCardOpen(true) : undefined}
        />
```

Immediately before the closing tag of the component's root `</div>` (next to the `<PaymentModal ...>` render near line 839) add:

```tsx
      <LinkCardDialog
        open={isLinkCardOpen}
        onOpenChange={setIsLinkCardOpen}
        storeId={storeId!}
        sessionId={sessionId}
        sessionLabel={session.tableDisplayName || (session.tableNumber ? `Table ${session.tableNumber}` : undefined)}
      />
```
(`session.tableDisplayName` — if it does not exist on this `session` type, use `session.tableNumber` only; `npm run typecheck` will say.)

- [ ] **Step 3: Create `SessionCardBanner`**

```tsx
// src/components/cashier/SessionCardBanner.tsx
"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Button } from "@/components/ui/button";
import { CardPill } from "./CardPill";
import { LinkCardDialog } from "./LinkCardDialog";
import { cardPillModel, estimateEarnPoints } from "@/lib/loyalty/session-link";
import { useOnlineStatus } from "@/hooks/use-online-status";

type LinkDoc = {
  linkedCustomerPhone?: string | null;
  linkedCustomerName?: string | null;
  linkedBy?: string | null;
  linkedCustomerLockedAt?: unknown;
};

/**
 * Loyalty status strip at the top of the payment modal. Reads the live
 * activeSessions doc so a card linked mid-checkout (cashier or diner) shows up
 * immediately. This is the same field `payment-modal` reads at submit to earn
 * points, so what the banner shows is what will be awarded.
 */
export function SessionCardBanner({
  storeId,
  sessionId,
  grandTotal,
  loyaltyConfig,
  canLink,
}: {
  storeId: string;
  sessionId: string;
  grandTotal: number;
  loyaltyConfig?: { isEnabled?: boolean; pointsPerPeso?: number } | null;
  canLink: boolean;
}) {
  const isOnline = useOnlineStatus();
  const [link, setLink] = useState<LinkDoc | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const ref = doc(db, "stores", storeId, "activeSessions", sessionId);
    return onSnapshot(ref, (snap) => setLink(snap.exists() ? (snap.data() as LinkDoc) : null), () => setLink(null));
  }, [storeId, sessionId]);

  const m = cardPillModel(link ?? {});
  const points = estimateEarnPoints(grandTotal, loyaltyConfig);
  const lockedOut = !!link?.linkedCustomerLockedAt;

  if (m.linked) {
    return (
      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <CardPill session={link!} />
          <span className="text-muted-foreground truncate">
            {loyaltyConfig?.isEnabled === false ? "Loyalty off for this store" : "Earning points"}
          </span>
        </div>
        {points > 0 && <span className="shrink-0 font-medium">≈ {points} pts</span>}
      </div>
    );
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        <span>No loyalty card linked</span>
        {canLink && !lockedOut && (
          isOnline ? (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setDialogOpen(true)}>
              Link card
            </Button>
          ) : (
            <span className="text-xs">Linking needs internet</span>
          )
        )}
      </div>
      <LinkCardDialog open={dialogOpen} onOpenChange={setDialogOpen} storeId={storeId} sessionId={sessionId} />
    </>
  );
}
```

- [ ] **Step 4: Mount the banner in `PaymentModal`**

Add imports in `payment-modal.tsx`:

```tsx
import { SessionCardBanner } from "@/components/cashier/SessionCardBanner";
```

Inside `paymentForm`, directly after `</DialogHeader>` (line 520), add:

```tsx
      <SessionCardBanner
        storeId={storeId}
        sessionId={sessionId}
        grandTotal={grandTotal}
        loyaltyConfig={activeStore.loyaltyConfig}
        canLink={appUser?.role === "admin" || appUser?.role === "manager" || appUser?.role === "cashier"}
      />
```

Do not change the submit logic: it already reads `linkedCustomerPhone` from `activeSessions` at line 410, which is what the cashier link writes.

- [ ] **Step 5: Typecheck and run all tests**

Run: `npm run typecheck && npm test`
Expected: typecheck clean for touched files; all vitest suites pass (including the 4 new test files).

- [ ] **Step 6: Commit**

```bash
git add src/components/cashier/SessionCardBanner.tsx src/components/cashier/session-header.tsx src/components/cashier/session-detail-view.tsx src/components/cashier/payment-modal.tsx
git commit -m "feat(cashier): loyalty banner on bill screen and link action in session header"
```

---

### Task 8: Browser verification and wrap-up

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server on the reserved port**

Run: `npm run dev` (port 9003; do not use another port).

- [ ] **Step 2: Walk the flows with the verifying-ui-in-a-browser skill**

Check each, with a screenshot or DOM read as evidence:
1. `/cashier` — each session card shows guest pill (non-alacarte) and a pill: grey "No card" (button for admin/manager/cashier) or black `★ Name` for linked sessions.
2. Click "No card" → `LinkCardDialog` opens; clicking the card itself still navigates (stopPropagation works).
3. Search tab: a full phone finds an existing customer; a 2+ char name finds only this store's past customers; confirm step shows name, masked phone, points; "Link to this bill" → toast, pill flips to `★ Name via cashier` without reload.
4. Session detail header shows the pill; Link action appears only when unlinked and unpaid.
5. Open Pay → banner shows linked state with `≈ N pts`, or amber "No loyalty card linked" + Link card button; linking from the banner updates it live.
6. Bill out a cashier-linked session in a test store; confirm a `pointsLedger` doc with `type: "earn"` and `receiptId` exists for the customer.
7. Try linking a second, different card to an already linked session via the API (curl/devtools) → 409.
8. Offline (devtools Network offline): dialog shows "Linking needs an internet connection."; banner shows "Linking needs internet"; payment still completes.

- [ ] **Step 3: Record the result**

If `find-customer` hits an index error, add the index it names to `firestore.indexes.json` (see Task 3 Step 5). Report: files changed, test counts, and which of checks 1–8 passed, in ≤15 lines.

- [ ] **Step 4: Stop the dev server** (so a later `next build` does not clobber `.next`).
