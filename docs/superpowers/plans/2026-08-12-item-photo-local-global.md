# Item Photos: Local (Store) vs. Global (Admin-Promoted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a manager upload a photo for an item at their own store (local, live immediately at that store only), and let an admin promote a store's photo to be every store's default or reject it — resetting every store that was relying on it.

**Architecture:** `InventoryItem.imageUrl` (already exists, already manager/admin-writable) becomes the per-store local override; `Product.imageUrl` (already exists, admin-only) stays the global default. Display everywhere becomes `inventoryItem.imageUrl ?? product.imageUrl` — no fan-out writes. A new server-mediated `productPhotoRequests` collection + `/api/product-photo-requests` route (mirroring the existing `productRequests` pattern) tracks the review lifecycle; clients never write it directly.

**Tech Stack:** Next.js App Router API routes (Admin SDK), Firestore + Storage (client SDK for uploads, Admin SDK for the route), React/shadcn UI, Vitest.

**Full design:** `docs/superpowers/specs/2026-08-12-item-photo-local-global-design.md`

## Global Constraints

- `productPhotoRequests` Firestore writes are always denied to clients (`allow create, update, delete: if false`) — every write goes through the API route, matching `productRequests`.
- `promote` and `reject` must read `imageUrl` and other request fields from the **stored** `productPhotoRequests` doc server-side, never trust a client-supplied value for these ops (this session's audit found this exact class of bug repeatedly).
- `submit`/`remove` must use `requireStaffStoreAccess` (not `requireActiveStaff`) so a manager cannot act on a store they aren't assigned to.
- This repo (POS, branch `sev6`/`sev5_advanced`): do not commit or push without being explicitly asked — stop after each task's tests pass and hand off.
- Image URLs accepted into any Firestore write must match `^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/` (mirrors the existing `isAllowedImageUrl` check in `/api/product-requests`).

---

### Task 1: Firestore rules — `productPhotoRequests` collection

**Files:**
- Modify: `firestore.rules:428-430` (insert new match block between the existing `productRequests` block and the `users` block)
- Modify: `tests/rules/store-scoped.test.ts:461-463` (insert new tests between the existing `productRequests` denial test and the "allows an active admin to create a product" test, inside the same `describe("global catalog writes remain admin-only", ...)` block)

**Interfaces:**
- Produces: the `productPhotoRequests/{requestId}` collection is client-read-only for any `isActiveStaff()`, all writes denied — Task 3's API route is the only writer.

- [ ] **Step 1: Add the failing rules tests**

In `tests/rules/store-scoped.test.ts`, insert immediately after this existing block (currently lines 459-461):

```ts
  it("denies a manager writing productRequests directly (API-only)", async () => {
    await assertFails(setDoc(doc(db("manager"), "productRequests", "pr1"), { status: "approved" }));
  });
```

add:

```ts
  it("denies a manager writing productPhotoRequests directly (API-only)", async () => {
    await assertFails(
      setDoc(doc(db("manager"), "productPhotoRequests", "storeA_p1"), { status: "approved" })
    );
  });

  it("denies an admin writing productPhotoRequests directly (API-only)", async () => {
    await assertFails(
      setDoc(doc(db("admin"), "productPhotoRequests", "storeA_p1"), { status: "approved" })
    );
  });

  it("allows staff to read productPhotoRequests", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore() as any, "productPhotoRequests", "storeA_p1"), {
        storeId: STORE_A,
        productId: "p1",
        status: "pending",
      });
    });
    await assertSucceeds(getDoc(doc(db("cashier"), "productPhotoRequests", "storeA_p1")));
  });
```

(`getDoc` is already imported at the top of this file — no import change needed.)

- [ ] **Step 2: Run the tests to verify current behavior**

Run: `npm run test:rules`
Expected: **all three tests already PASS**, even before Step 3 adds the explicit rule block. This repo's root fallback (`firestore.rules`, near the bottom) already denies `create`/`update`/`delete` on any unlisted collection by default, and already allows `read`/`list` to any `isActiveStaff()` on any collection not explicitly excluded — `productPhotoRequests` isn't excluded, so it inherits both behaviors for free. This is the same situation the existing `productRequests` block's own comment documents: the explicit block isn't functionally required, it exists so the collection's access model is documented in one place next to the collection itself, rather than left implicit in a fallback a future reader has to trace through. Step 3 adds the explicit block for that same documentation reason — not because these tests are currently failing.

- [ ] **Step 3: Add the rule**

In `firestore.rules`, insert immediately after line 428 (the closing `}` of the `productRequests` match block) and before line 430 (`// Legacy user profiles...`):

```
    // -----------------------------
    // PRODUCT PHOTO REQUESTS (item photo local/global review workflow)
    // A manager uploads a photo for an item at their store; an admin promotes
    // it to be every store's default (products/{id}.imageUrl) or rejects it.
    // requestId is `${storeId}_${productId}` — one active request per pair.
    //
    // EVERY write goes through POST /api/product-photo-requests (Admin SDK,
    // bypasses these rules) — clients are strictly read-only here, same as
    // productRequests just above. Review fields (status, reviewedBy*) must
    // never be forgeable by a direct client write.
    // -----------------------------
    match /productPhotoRequests/{requestId} {
      allow read, list: if isActiveStaff();
      allow create, update, delete: if false;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:rules`
Expected: all tests pass, including the 3 new ones (total count increases by 3 from the current 201).

- [ ] **Step 5: Commit**

```bash
git add firestore.rules tests/rules/store-scoped.test.ts
git commit -m "Add productPhotoRequests Firestore rules (client-read-only, API-only writes)"
```

---

### Task 2: Storage rules — `productPhotos` path

**Files:**
- Modify: `storage.rules:84-85` (insert new match block between the `loyaltyRewardImages` block and the `productRequestImages` comment)

**Interfaces:**
- Produces: `productPhotos/{productId}/{storeId}/{fileName}` writable by `isStoreManagerOrAdmin(uid, storeId)`, public read (via the existing root `{allPaths=**} { allow read; }` rule — no change needed there).

> **Shipped deviation (recorded 2026-08-12):** Tasks 2 and 12 below were written against a deterministic `…/{storeId}.webp` object name. The code that shipped uses a per-upload `crypto.randomUUID()` filename (`storage.rules:98`, `src/lib/firebase/client.ts:63`) so that replacing a local photo after promotion cannot overwrite the object every store's global `products/{id}.imageUrl` points at. The snippets below have been corrected to match what shipped.

- [ ] **Step 1: Add the rule**

In `storage.rules`, insert immediately after line 84 (the closing `}` of the `loyaltyRewardImages` block) and before line 86 (`// Proposed product photos...`):

```
    // Local per-store item photos, pending admin review (see
    // /api/product-photo-requests). Path is store-scoped so two stores
    // uploading a photo for the same product never collide on one object;
    // promoting one just points products/{id}.imageUrl at this same URL,
    // no file copy needed.
    match /productPhotos/{productId}/{storeId}/{fileName} {
      allow write: if request.auth != null
        && isStoreManagerOrAdmin(request.auth.uid, storeId)
        && isImageUnder(4);
    }
```

- [ ] **Step 2: Manually verify (no automated Storage-rules test harness exists in this repo)**

This repo's `npm run test:rules` only covers Firestore rules against the Firestore emulator — there is no Storage emulator test suite to extend. Verify by inspection: the new block follows the exact same shape as the `qrWallet` block a few lines below it (`isStoreManagerOrAdmin(uid, storeId)` + `isImageUnder`), which is already covered by manual QA in production. Confirm `storage.rules` still parses by running the existing rules-test command, which loads `firestore.rules` only but will still fail loudly on a Firebase project/deploy dry-run if `storage.rules` has a syntax error — do a syntax sanity check instead:

Run: `npx firebase deploy --only storage --dry-run --project shareat-hub-v2` (or equivalent dry-run flag available in the installed `firebase-tools` version — check `firebase deploy --help` if `--dry-run` isn't recognized for `storage`; if no dry-run exists for Storage rules, at minimum run `node -e "require('fs').readFileSync('storage.rules','utf8')"` to confirm the file is well-formed UTF-8, and read the full modified file back to visually confirm brace balance).

- [ ] **Step 3: Commit**

```bash
git add storage.rules
git commit -m "Add productPhotos Storage rule for local item photo uploads"
```

---

### Task 3: API route `/api/product-photo-requests`

**Files:**
- Modify: `src/lib/types.ts:177` (insert `ProductPhotoRequest` type after the `ProductRequest` type's closing `};`)
- Create: `src/app/api/product-photo-requests/route.ts`
- Test: `src/app/api/product-photo-requests/route.test.ts`

**Interfaces:**
- Consumes: `requireStaffStoreAccess(db, decoded, storeId, allowedRoles)` from `@/lib/server/staff-access` (returns `{uid, role, assignedStoreIds, isPlatformAdmin}`); `requireActiveStaff(db, decoded, allowedRoles)` from `@/lib/server/active-staff-check` (returns `{uid, role, displayName, assignedStoreIds, isPlatformAdmin}`).
- Produces: `POST /api/product-photo-requests` with body `{op: "submit", storeId, productId, imageUrl}` | `{op: "remove", storeId, productId}` | `{op: "promote", requestId}` | `{op: "reject", requestId}`. Every response is `{ok: true, ...}` or `{ok: false, error: string}` with an HTTP status (400/401/403/404/409/500). Tasks 5 and 6 call this route by fetch.

- [ ] **Step 1: Add the `ProductPhotoRequest` type**

In `src/lib/types.ts`, insert immediately after line 177 (the `};` closing `ProductRequest`) and before line 179 (`/**`):

```ts

export type ProductPhotoStatus = "pending" | "approved" | "rejected";

/**
 * A manager's local photo upload for an item at their store, awaiting (or
 * having received) an admin decision on whether to promote it to be the
 * item's photo for every store. See
 * docs/superpowers/specs/2026-08-12-item-photo-local-global-design.md.
 *
 * id is `${storeId}_${productId}` — deterministic, so there is at most one
 * active request per (store, product) pair; resubmitting overwrites it
 * rather than accumulating history.
 */
export type ProductPhotoRequest = {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  productName: string;
  status: ProductPhotoStatus;
  imageUrl: string;
  submittedByUid: string;
  submittedByName: string;
  submittedAt: Timestamp;
  reviewedByUid?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: Timestamp | null;
};
```

- [ ] **Step 2: Write the failing test file**

Create `src/app/api/product-photo-requests/route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

/**
 * Route-level tests for /api/product-photo-requests, focused on the auth
 * matrix (this session's audit found admin routes need explicit per-op
 * role/store-scope tests, not just a happy path) and the
 * reject-only-clears-if-still-current guard.
 */

const MANAGER_UID = "mgr_1";
const ADMIN_UID = "admin_1";
const STORE_A = "storeA";
const STORE_B = "storeB";
const PRODUCT = "prod_1";
const IMAGE_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/productPhotos%2Fprod_1%2FstoreA.webp";

// --- module mocks ------------------------------------------------------

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
  },
}));

let mockCallerUid = MANAGER_UID;

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async () => ({ uid: mockCallerUid, name: "Caller", email: "caller@example.com" }),
  }),
  getAdminDb: () => harness.db,
}));

let mockStoreAccessImpl: (storeId: string) => Promise<{
  uid: string; role: string; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;
let mockActiveStaffImpl: (allowedRoles: string[]) => Promise<{
  uid: string; role: string; displayName: string | null; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;

vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _decoded: any, storeId: string) => mockStoreAccessImpl(storeId),
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async (_db: any, _decoded: any, allowedRoles: string[]) => mockActiveStaffImpl(allowedRoles),
}));

import { POST } from "./route";

// --- in-memory firestore double -----------------------------------------

function makeHarness(docs: Record<string, any>) {
  const makeRef = (path: string) => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
  });

  const db = {
    doc: (path: string) => makeRef(path),
    collection: (path: string) => ({ doc: (id: string) => makeRef(`${path}/${id}`) }),
    batch: () => ({
      set: (ref: any, data: any) => {
        docs[ref.path] = { ...(docs[ref.path] || {}), ...data };
      },
      update: (ref: any, data: any) => {
        docs[ref.path] = { ...(docs[ref.path] || {}), ...data };
      },
      delete: (ref: any) => {
        delete docs[ref.path];
      },
      commit: async () => {},
    }),
  };

  return { db, docs };
}

let harness: ReturnType<typeof makeHarness>;

function req(body: any) {
  return new Request("http://localhost/api/product-photo-requests", {
    method: "POST",
    headers: { Authorization: "Bearer faketoken", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCallerUid = MANAGER_UID;
  mockStoreAccessImpl = async (storeId: string) => {
    if (storeId !== STORE_A) throw new Error("No access to this store.");
    return { uid: MANAGER_UID, role: "manager", assignedStoreIds: [STORE_A], isPlatformAdmin: false };
  };
  mockActiveStaffImpl = async () => {
    throw new Error("You are not allowed to access this route.");
  };
  harness = makeHarness({
    [`products/${PRODUCT}`]: { name: "Coke", imageUrl: null },
    [`stores/${STORE_A}`]: { name: "Shareat Lipa" },
    [`stores/${STORE_A}/inventory/${PRODUCT}`]: { name: "Coke", imageUrl: null },
  });
});

describe("submit", () => {
  it("allows a manager to submit a photo for their own store", async () => {
    const res = await POST(req({ op: "submit", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBe(IMAGE_URL);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("pending");
  });

  it("denies a manager submitting for a store they aren't assigned to", async () => {
    const res = await POST(req({ op: "submit", storeId: STORE_B, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(403);
  });

  it("rejects an image URL that isn't from our Storage bucket", async () => {
    const res = await POST(
      req({ op: "submit", storeId: STORE_A, productId: PRODUCT, imageUrl: "https://evil.example.com/x.webp" })
    );
    expect(res.status).toBe(400);
  });
});

describe("remove", () => {
  it("clears the store's local imageUrl and deletes the request", async () => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = { status: "pending" };
    const res = await POST(req({ op: "remove", storeId: STORE_A, productId: PRODUCT }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`]).toBeUndefined();
  });

  it("denies a manager removing another store's photo", async () => {
    const res = await POST(req({ op: "remove", storeId: STORE_B, productId: PRODUCT }));
    expect(res.status).toBe(403);
  });
});

describe("promote — admin only", () => {
  beforeEach(() => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      id: `${STORE_A}_${PRODUCT}`,
      storeId: STORE_A,
      productId: PRODUCT,
      status: "pending",
      imageUrl: IMAGE_URL,
    };
  });

  it("denies a manager (even for their own store's request)", async () => {
    const res = await POST(req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(403);
  });

  it("allows an admin, setting products/{id}.imageUrl from the STORED request, not the request body", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    const res = await POST(
      req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}`, imageUrl: "https://evil.example.com/spoofed.webp" })
    );
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBe(IMAGE_URL);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("approved");
  });

  it("refuses to promote a request that was already decided", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status = "approved";
    const res = await POST(req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(409);
  });
});

describe("reject — admin only", () => {
  it("denies a manager", async () => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "pending", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(403);
  });

  it("on a pending request, clears the store's local photo but never touches products/{id}.imageUrl", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "pending", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = null;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("rejected");
  });

  it("on an approved request whose photo is still the global one, clears products/{id}.imageUrl too", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "approved", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = IMAGE_URL;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBeNull();
  });

  it("on an approved request whose photo was superseded by a different promotion, leaves products/{id}.imageUrl alone", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    const otherUrl = "https://firebasestorage.googleapis.com/v0/b/x/o/productPhotos%2Fprod_1%2FstoreB.webp";
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "approved", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = otherUrl;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBe(otherUrl);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/app/api/product-photo-requests/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 4: Write the route**

Create `src/app/api/product-photo-requests/route.ts`:

```ts
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

/**
 * Local (per-store) item photo submissions, and their admin promote/reject
 * review. Every write goes through here — productPhotoRequests is
 * client-read-only in firestore.rules, same reasoning as productRequests:
 * status/reviewer fields must be stamped server-side, not trusted from the
 * client, and promote/reject also write products/{id}.imageUrl, which
 * firestore.rules restricts to isAdmin().
 *
 * See docs/superpowers/specs/2026-08-12-item-photo-local-global-design.md.
 */

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "submit" | "remove" | "promote" | "reject";

/** Only accept image URLs we actually issued, not arbitrary remote URLs. */
function isAllowedImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(value);
}

function requestId(storeId: string, productId: string) {
  return `${storeId}_${productId}`;
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    const db = getAdminDb();

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;

    switch (op) {
      // ---------------------------------------------------------------------
      case "submit": {
        const storeId = String(body?.storeId || "").trim();
        const productId = String(body?.productId || "").trim();
        if (!storeId || !productId) return bad("storeId and productId are required.", 400);

        const staff = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

        const imageUrl = body?.imageUrl;
        if (!isAllowedImageUrl(imageUrl)) return bad("Invalid image URL.", 400);

        const productSnap = await db.doc(`products/${productId}`).get();
        if (!productSnap.exists) return bad("Product not found.", 404);
        const productName = String((productSnap.data() as any)?.name ?? "") || productId;

        const storeSnap = await db.doc(`stores/${storeId}`).get();
        if (!storeSnap.exists) return bad("Store not found.", 404);
        const storeName = String((storeSnap.data() as any)?.name ?? "") || storeId;

        const invRef = db.doc(`stores/${storeId}/inventory/${productId}`);
        const invSnap = await invRef.get();
        if (!invSnap.exists) return bad("This item is not in that store's inventory.", 404);

        const ref = db.collection("productPhotoRequests").doc(requestId(storeId, productId));
        const batch = db.batch();
        batch.set(ref, {
          id: ref.id,
          storeId,
          storeName,
          productId,
          productName,
          status: "pending",
          imageUrl,
          submittedByUid: staff.uid,
          submittedByName: decoded.name || decoded.email || staff.uid,
          submittedAt: FieldValue.serverTimestamp(),
          reviewedByUid: null,
          reviewedByName: null,
          reviewedAt: null,
        });
        batch.update(invRef, { imageUrl, updatedAt: FieldValue.serverTimestamp() });
        await batch.commit();

        return NextResponse.json({ ok: true, id: ref.id });
      }

      // ---------------------------------------------------------------------
      case "remove": {
        const storeId = String(body?.storeId || "").trim();
        const productId = String(body?.productId || "").trim();
        if (!storeId || !productId) return bad("storeId and productId are required.", 400);

        await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

        const invRef = db.doc(`stores/${storeId}/inventory/${productId}`);
        const invSnap = await invRef.get();
        if (!invSnap.exists) return bad("This item is not in that store's inventory.", 404);

        const ref = db.collection("productPhotoRequests").doc(requestId(storeId, productId));
        const batch = db.batch();
        batch.update(invRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
        batch.delete(ref);
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "promote": {
        const staff = await requireActiveStaff(db, decoded, ["admin"]);

        const reqId = String(body?.requestId || "").trim();
        if (!reqId) return bad("requestId is required.", 400);

        const ref = db.collection("productPhotoRequests").doc(reqId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;
        if (r.status !== "pending") return bad(`Request is already ${r.status}.`, 409);

        const batch = db.batch();
        batch.update(db.doc(`products/${r.productId}`), {
          imageUrl: r.imageUrl,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.update(ref, {
          status: "approved",
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "reject": {
        const staff = await requireActiveStaff(db, decoded, ["admin"]);

        const reqId = String(body?.requestId || "").trim();
        if (!reqId) return bad("requestId is required.", 400);

        const ref = db.collection("productPhotoRequests").doc(reqId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;
        if (r.status === "rejected") return bad("Request is already rejected.", 409);

        const batch = db.batch();

        // Only clear the global image if it's still THIS request's photo — an
        // intervening different promotion (another store, approved later)
        // must not be clobbered by rejecting a stale one.
        if (r.status === "approved") {
          const productRef = db.doc(`products/${r.productId}`);
          const productSnap = await productRef.get();
          if (productSnap.exists && (productSnap.data() as any)?.imageUrl === r.imageUrl) {
            batch.update(productRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
          }
        }

        // Reset the originating store back to no local override.
        const invRef = db.doc(`stores/${r.storeId}/inventory/${r.productId}`);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          batch.update(invRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
        }

        batch.update(ref, {
          status: "rejected",
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required/i.test(message)
      ? 400
      : /not allowed|no access|not a staff|not active|token/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/app/api/product-photo-requests/route.test.ts`
Expected: all tests PASS (13 tests across 4 describe blocks).

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/app/api/product-photo-requests/route.ts src/app/api/product-photo-requests/route.test.ts
git commit -m "Add /api/product-photo-requests route (submit/remove/promote/reject)"
```

---

### Task 4: Client Storage upload helper

**Files:**
- Modify: `src/lib/firebase/client.ts:40-41` (insert new function after `uploadProductImage`'s closing `}` and before `uploadUserAvatar`)

**Interfaces:**
- Consumes: `storage`, `ref`, `uploadBytes`, `getDownloadURL` — all already imported/initialized at the top of this file.
- Produces: `uploadItemPhotoLocal(productId: string, storeId: string, file: File): Promise<string>` — Tasks 5 and 7's manager UI calls this before calling the API route's `submit` op.

- [ ] **Step 1: Add the function**

In `src/lib/firebase/client.ts`, insert immediately after line 40 (the `}` closing `uploadProductImage`) and before line 42 (`export async function uploadUserAvatar`):

```ts

/**
 * Uploads a manager's local photo for an item at their own store to
 * productPhotos/{productId}/{storeId}/{uuid}.webp. Does NOT write any Firestore
 * field itself — callers must follow up with POST /api/product-photo-requests
 * { op: "submit", storeId, productId, imageUrl } so the submission is
 * recorded and reviewable, not just silently applied.
 */
export async function uploadItemPhotoLocal(productId: string, storeId: string, file: File): Promise<string> {
    if (!productId || !storeId) {
        throw new Error("Product ID and store ID are required to upload a photo.");
    }

    const storageRef = ref(storage, `productPhotos/${productId}/${storeId}/${crypto.randomUUID()}.webp`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no new type errors. No dedicated unit test — matches the existing untested precedent for `uploadProductImage`/`uploadStoreLogo`/`uploadReceiptLogo` in this same file (thin Storage SDK wrappers); covered instead by Task 7's manual smoke test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/client.ts
git commit -m "Add uploadItemPhotoLocal Storage upload helper"
```

---

### Task 5: Manager UI — photo tab in `EditInventoryDialog`

**Files:**
- Modify: `src/components/manager/inventory/edit-inventory-dialog.tsx` (add imports, a new `PhotoTab` component, a `storeId` prop, and a 5th tab)
- Modify: `src/app/manager/inventory/page.tsx:753-761` (pass the new `storeId` prop)

**Interfaces:**
- Consumes: `uploadItemPhotoLocal` from Task 4; `POST /api/product-photo-requests` `{op:"submit"}`/`{op:"remove"}` from Task 3; `ProductPhotoRequest`, `Product` types from Task 3.
- Produces: nothing new consumed elsewhere — this is a leaf UI change.

- [ ] **Step 1: Add imports**

In `src/components/manager/inventory/edit-inventory-dialog.tsx`, add to the top of the import block (after line 17, `import { Info } from "lucide-react";`):

```tsx
import { Camera, Trash2, Loader2 } from "lucide-react";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db, uploadItemPhotoLocal } from "@/lib/firebase/client";
import { getAuth } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import type { Product, ProductPhotoRequest } from "@/lib/types";
import Image from "next/image";
```

(Remove the plain `import { Info } from "lucide-react";` line and fold it into the new `lucide-react` import — combine into a single `import { Info, Camera, Trash2, Loader2 } from "lucide-react";` to avoid two import statements from the same module.)

- [ ] **Step 2: Add the `PhotoTab` component**

Insert immediately after the closing `}` of `AvailabilitySwitch` (currently ending at line 211) and before `export function EditInventoryDialog` (currently line 213):

```tsx
function PhotoTab({ item, storeId }: { item: InventoryItem; storeId: string }) {
  const { toast } = useToast();
  const [globalImageUrl, setGlobalImageUrl] = React.useState<string | null>(null);
  const [request, setRequest] = React.useState<ProductPhotoRequest | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, "products", item.productId)).then((snap) => {
      if (cancelled) return;
      setGlobalImageUrl(snap.exists() ? ((snap.data() as Product).imageUrl ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [item.productId]);

  React.useEffect(() => {
    const reqId = `${storeId}_${item.productId}`;
    const unsub = onSnapshot(doc(db, "productPhotoRequests", reqId), (snap) => {
      setRequest(snap.exists() ? ({ id: snap.id, ...snap.data() } as ProductPhotoRequest) : null);
    });
    return unsub;
  }, [storeId, item.productId]);

  const effectiveImageUrl = item.imageUrl ?? globalImageUrl;
  const isLocal = !!item.imageUrl;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const imageUrl = await uploadItemPhotoLocal(item.productId, storeId, file);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "submit", storeId, productId: item.productId, imageUrl }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to submit photo.");
      toast({ title: "Photo submitted", description: "Sent for admin review. It's already showing at your store." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Upload failed", description: err?.message || "Something went wrong." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    setIsUploading(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "remove", storeId, productId: item.productId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to remove photo.");
      toast({ title: "Photo removed" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Remove failed", description: err?.message || "Something went wrong." });
    } finally {
      setIsUploading(false);
    }
  };

  const statusLabel = !request
    ? null
    : request.status === "pending"
      ? "Pending admin review"
      : request.status === "approved"
        ? "Live for every store"
        : "Rejected by admin — upload a different photo?";

  return (
    <div className="space-y-4">
      <div className="w-32 h-32 rounded-md bg-muted flex items-center justify-center relative mx-auto overflow-hidden">
        {effectiveImageUrl ? (
          <Image src={effectiveImageUrl} alt={item.name} fill style={{ objectFit: "cover" }} />
        ) : (
          <Camera className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      {effectiveImageUrl && !isLocal && (
        <p className="text-xs text-center text-muted-foreground">Inherited from the global catalog photo.</p>
      )}
      {statusLabel && <p className="text-xs text-center font-medium">{statusLabel}</p>}
      <div className="flex justify-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
          {isLocal ? "Replace photo" : "Upload photo"}
        </Button>
        {isLocal && (
          <Button type="button" variant="ghost" size="sm" disabled={isUploading} onClick={handleRemove}>
            <Trash2 className="mr-2 h-4 w-4" /> Remove
          </Button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      <p className="text-xs text-muted-foreground text-center">
        This photo shows at your store immediately. An admin can promote it to be every store's default, or reject it.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Add the `storeId` prop and the 5th tab**

In `EditInventoryDialogProps` (currently lines 56-64), add `storeId: string;` after `item: InventoryItem;`:

```tsx
interface EditInventoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem;
  storeId: string;
  kitchenLocations: KitchenLocation[];
  onSave: (item: InventoryItem, data: any) => void;
  onToggle: (item: InventoryItem, field: ToggleField) => void;
  isSubmitting: boolean;
}
```

Change the component signature (currently line 213) from:
```tsx
export function EditInventoryDialog({ isOpen, onClose, item, onSave, onToggle, isSubmitting, kitchenLocations }: EditInventoryDialogProps) {
```
to:
```tsx
export function EditInventoryDialog({ isOpen, onClose, item, storeId, onSave, onToggle, isSubmitting, kitchenLocations }: EditInventoryDialogProps) {
```

Change the `TabsList` (currently lines 269-274) from `grid-cols-4` to `grid-cols-5` and add the trigger:
```tsx
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="setup">Setup</TabsTrigger>
                <TabsTrigger value="in-store">In-Store</TabsTrigger>
                <TabsTrigger value="online">Online</TabsTrigger>
                <TabsTrigger value="customer">Customer</TabsTrigger>
                <TabsTrigger value="photo">Photo</TabsTrigger>
              </TabsList>
```

Add the tab content immediately after the `customer` `TabsContent` block closes (currently ending at line 353) and before the closing `</Tabs>` (currently line 354):
```tsx
              <TabsContent value="photo" className="space-y-4">
                <PhotoTab item={item} storeId={storeId} />
              </TabsContent>
```

- [ ] **Step 4: Wire `storeId` at the call site**

In `src/app/manager/inventory/page.tsx`, change the `<EditInventoryDialog>` render (currently lines 753-761) from:
```tsx
        <EditInventoryDialog
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
            item={selectedItem}
            kitchenLocations={kitchenLocations}
            onSave={handleEditItem}
            onToggle={handleToggle}
            isSubmitting={isSubmitting}
        />
```
to:
```tsx
        <EditInventoryDialog
            isOpen={isEditOpen}
            onClose={() => setIsEditOpen(false)}
            item={selectedItem}
            storeId={activeStore!.id}
            kitchenLocations={kitchenLocations}
            onSave={handleEditItem}
            onToggle={handleToggle}
            isSubmitting={isSubmitting}
        />
```

(`activeStore!` is safe here: this render is already gated by `selectedItem` being non-null, which is only ever set from data loaded after `activeStore` resolved — non-null assertion matches this file's existing style for post-guard access, consistent with how `activeStore.id` is used unguarded a few lines above in the same render.)

- [ ] **Step 5: Manual verification**

No automated test — this dialog has no existing test file to extend (matches the codebase's existing untested precedent for manager dialogs). Verify via Task 7's dev-server smoke test: open `/manager/inventory`, edit an item, confirm the "Photo" tab renders without a console error.

- [ ] **Step 6: Commit**

```bash
git add src/components/manager/inventory/edit-inventory-dialog.tsx src/app/manager/inventory/page.tsx
git commit -m "Add manager photo upload tab to the inventory edit dialog"
```

---

### Task 6: Admin UI — pending-photo badge + review dialog on `/admin/menu/products`

**Files:**
- Create: `src/components/admin/menu/product-photo-review-dialog.tsx`
- Modify: `src/app/admin/menu/products/page.tsx` (imports, new state + listener, badge in the row, dialog render)

**Interfaces:**
- Consumes: `POST /api/product-photo-requests` `{op:"promote"}`/`{op:"reject"}` from Task 3; `ProductPhotoRequest` type from Task 3.
- Produces: nothing new consumed elsewhere — leaf UI change.

- [ ] **Step 1: Create the review dialog component**

Create `src/components/admin/menu/product-photo-review-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { getAuth } from "firebase/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ProductPhotoRequest } from "@/lib/types";
import Image from "next/image";
import { Loader2 } from "lucide-react";

interface ProductPhotoReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  requests: ProductPhotoRequest[];
}

export function ProductPhotoReviewDialog({ isOpen, onClose, productName, requests }: ProductPhotoReviewDialogProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const act = async (op: "promote" | "reject", requestId: string) => {
    setBusyId(requestId);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op, requestId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || `Failed to ${op}.`);
      toast({ title: op === "promote" ? "Promoted to global" : "Rejected" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Action failed", description: err?.message || "Something went wrong." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{productName} — pending store photos</DialogTitle>
          <DialogDescription>
            Promote a store's photo to be every store's default, or reject it. Rejecting an already-global photo
            resets every store relying on it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {requests.length === 0 && <p className="text-sm text-muted-foreground">No pending photos for this product.</p>}
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="w-14 h-14 rounded-md bg-muted relative overflow-hidden shrink-0">
                <Image src={r.imageUrl} alt={r.storeName} fill style={{ objectFit: "cover" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.storeName}</p>
                <p className="text-xs text-muted-foreground truncate">by {r.submittedByName}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" disabled={busyId === r.id} onClick={() => act("promote", r.id)}>
                  {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Promote"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act("reject", r.id)}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire imports, state, and the listener in the products page**

In `src/app/admin/menu/products/page.tsx`, add to the import block (`query`/`where`/`collection`/`onSnapshot` are already imported at line 7 — no change needed there):

After line 26 (`import type { Product } from "@/lib/types";`), change to:
```tsx
import type { Product, ProductPhotoRequest } from "@/lib/types";
```

After line 32 (`import { ProductImportPreviewDialog } from "@/components/admin/product-import-preview-dialog";`), add:
```tsx
import { ProductPhotoReviewDialog } from "@/components/admin/menu/product-photo-review-dialog";
```

Add `Camera` to the existing lucide-react import at line 17 — change:
```tsx
import { Loader, PlusCircle, Power, PowerOff, Upload, Download, Package, Search, ArrowLeft, ChevronRight, ChevronDown, GitMerge, AlertTriangle, RefreshCw, Archive, ArchiveRestore } from "lucide-react";
```
to:
```tsx
import { Loader, PlusCircle, Power, PowerOff, Upload, Download, Package, Search, ArrowLeft, ChevronRight, ChevronDown, GitMerge, AlertTriangle, RefreshCw, Archive, ArchiveRestore, Camera } from "lucide-react";
```

Add new state after line 48 (`const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);`):
```tsx
  const [pendingPhotosByProduct, setPendingPhotosByProduct] = useState<Map<string, ProductPhotoRequest[]>>(new Map());
  const [reviewingProduct, setReviewingProduct] = useState<Product | null>(null);
```

Add a new `useEffect` — place it near the component's other top-level `useEffect` data listeners (search the file for the first `useEffect(() => {` that sets up the `products` `onSnapshot` listener and add this one immediately after that effect's closing `}, [...]);`):
```tsx
  useEffect(() => {
    const q = query(collection(db, "productPhotoRequests"), where("status", "==", "pending"));
    const unsub = onSnapshot(q, (snapshot) => {
      const byProduct = new Map<string, ProductPhotoRequest[]>();
      snapshot.docs.forEach((d) => {
        const r = { id: d.id, ...d.data() } as ProductPhotoRequest;
        const list = byProduct.get(r.productId) || [];
        list.push(r);
        byProduct.set(r.productId, list);
      });
      setPendingPhotosByProduct(byProduct);
    });
    return unsub;
  }, []);
```

- [ ] **Step 3: Add the badge to the active-product row**

In the active (non-archived) row's name cell (currently lines 765-777), add the badge after the `isOrphan` badge block and before the closing `</div>`:
```tsx
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <span>{getDisplayName(p)}</span>
                                                {isGroup && (
                                                  <Badge variant="outline" className="text-xs">Family · {row.variants.length}</Badge>
                                                )}
                                                {isOrphan && (
                                                  <Badge variant="destructive" className="text-xs gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> Orphan variant
                                                  </Badge>
                                                )}
                                                {pendingPhotosByProduct.has(p.id) && (
                                                  <Badge
                                                    variant="outline"
                                                    className="text-xs gap-1 cursor-pointer"
                                                    onClick={(e) => { e.stopPropagation(); setReviewingProduct(p); }}
                                                  >
                                                    <Camera className="h-3 w-3" /> {pendingPhotosByProduct.get(p.id)!.length} pending
                                                  </Badge>
                                                )}
                                            </div>
                                        </TableCell>
```

- [ ] **Step 4: Render the dialog**

In `src/app/admin/menu/products/page.tsx`, insert immediately after line 1069 (the closing `)}` of the `mergeDialogOpen &&` block) and before line 1071 (`{Dialog}`):
```tsx
      {reviewingProduct && (
        <ProductPhotoReviewDialog
          isOpen={!!reviewingProduct}
          onClose={() => setReviewingProduct(null)}
          productName={reviewingProduct.name}
          requests={pendingPhotosByProduct.get(reviewingProduct.id) || []}
        />
      )}
```

- [ ] **Step 5: Manual verification**

No automated test — this page has no existing test file to extend (matches this codebase's existing untested precedent for admin catalog pages). Verify via Task 7's dev-server smoke test: submit a photo as a manager (Task 5), confirm the badge appears on `/admin/menu/products` for that product, open it, and confirm Promote/Reject both call the route without a console error (a real end-to-end promote/reject requires a signed-in admin session, which the automated smoke test in Task 7 cannot provide — this is a manual follow-up check, not scripted).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/menu/product-photo-review-dialog.tsx src/app/admin/menu/products/page.tsx
git commit -m "Add admin pending-photo badge and review dialog to /admin/menu/products"
```

---

### Task 7: Build and smoke test

**Files:** none (validation only)

- [ ] **Step 1: Run the full rules test suite**

Run: `npm run test:rules`
Expected: all tests pass (204 — the 201 from before this feature plus the 3 added in Task 1).

- [ ] **Step 2: Run the new route test file explicitly**

Run: `npx vitest run src/app/api/product-photo-requests/route.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: clean build, no TypeScript errors, `/api/product-photo-requests` appears in the route list alongside the other `ƒ` (dynamic) routes.

- [ ] **Step 4: Dev-server smoke test of the new route**

Start the dev server (`npm run dev`, default port 3000 per this repo's `next dev` config — NOT 9002), then:
```bash
curl -s -w "\n%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{"op":"submit"}' http://localhost:3000/api/product-photo-requests
```
Expected: `401` with `{"ok":false,"error":"Missing Authorization Bearer token."}` (no token supplied) — confirms the route compiles and executes without a 500. Repeat for `op":"promote"` and `op":"reject"` bodies for the same confirmation.

Stop the dev server afterward by killing the specific `node` process id printed when it started (check via `netstat`/`tasklist` filtered to the port, e.g. `netstat -ano | findstr :3000` then `taskkill /F /PID <pid>`) — **do not** run a blanket `taskkill /F /IM node.exe`, which kills every Node process on the machine, not just this one.

- [ ] **Step 5: Manual browser verification**

With the dev server running and signed in as a manager assigned to a real store: open `/manager/inventory`, edit an item, upload a photo on the new Photo tab, confirm it appears immediately and the status reads "Pending admin review". Sign in as an admin: open `/admin/menu/products`, confirm the "1 pending" badge appears on that product, open the review dialog, click Promote, confirm `products/{id}.imageUrl` updates in the Firestore console and the manager's dialog status flips to "Live for every store" on next open.

- [ ] **Step 6: Report**

Summarize what was verified automated vs. manual, and stop — per this repo's rule, do not commit anything beyond what each task already committed, and do not push without being explicitly asked.

## Self-Review Notes

- **Spec coverage:** every section of the design doc maps to a task — data model (Task 3), storage (Task 2 + 4), API route ops (Task 3), manager UI (Task 5), admin UI (Task 6), rules (Tasks 1-2), testing (Tasks 1, 3, 7).
- **Type consistency:** `ProductPhotoRequest` (Task 3) is the single source of type truth, imported unchanged by Tasks 5 and 6 — field names (`imageUrl`, `storeName`, `submittedByName`, `status`) match across the route, the manager dialog, and the admin dialog.
- **No placeholders:** every step has runnable code, not a description of code.
- **Known gap, intentionally deferred (matches the spec's non-goals):** archiving/deleting a product or inventory item while a photo request is pending is not handled — the request doc would simply become orphaned/moot. Not in scope for this plan.
