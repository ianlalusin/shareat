# Delivery Pricing & Load-Aware Prep Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admin/manager a real UI to configure per-store online-order delivery fee, minimum order, service-area note, and a baseline prep-time estimate — fields that have existed server-side since the storefront-catalog `set-config` op was built, but have never had a caller. On top of that baseline, make the prep-time estimate shown to customers dynamic: it bumps up automatically the busier the kitchen currently is, measured by the count of `preparing`-status kitchen tickets for that store.

**Architecture:** Two repos, three layers.
- **POS** (`C:\Users\ianla\webapps\POS`) gets a new admin/manager-only dialog on the Online Orders page that reads/writes `stores/{storeId}/storefrontConfig/main` via the existing (currently orphaned) `get` / `set-config` ops on `/api/admin/storefront-catalog`.
- **Shareat Website** (`C:\Users\ianla\webapps\Shareat Website`) Cloud Function `getStorefrontCatalog` computes the dynamic prep-time server-side, on every request, by combining the manager's configured baseline with a live count of that store's active kitchen tickets (read cross-project from the POS hub Firestore, same pattern already used for stores/config).
- **Shareat Website** frontend (`shop-checkout.ts` + `checkout.astro`) displays the returned ETA — currently `prepEtaMinutes` is already round-tripped through the API but never rendered anywhere.

**Tech Stack:** Next.js 14 (POS, TypeScript, Firestore client + Admin SDK), Astro + vanilla TS (website frontend), Firebase Cloud Functions v2 (Node 20, CommonJS), Firestore Admin SDK `.count()` aggregation queries, Vitest (POS), Node's built-in `node:test` + a hand-rolled in-memory Firestore stub (website).

## Global Constraints

- Do not add a test-only export to `functions/index.js` — the existing test harness (`tests/helpers/load-functions.cjs`) deliberately drives only the exported HTTP handlers; its own header comment states "index.js exposes no test hook." Keep new internal logic private and test it through the exported `getStorefrontCatalog` handler.
- `storefrontConfig/main` writes must stay **server-only** (this is enforced today by `firestore.rules` — `storefrontConfig` is explicitly excluded from the client wildcard write rule). All writes go through `/api/admin/storefront-catalog` using the Admin SDK. Do not add a client-side Firestore write to this collection.
- The existing `set-config` op (`POS/src/app/api/admin/storefront-catalog/route.ts:68-83`) writes with `.set(config, { merge: true })`, but it **unconditionally rebuilds all six known fields from the request body's defaults** before merging (`pickupEnabled: c.pickupEnabled !== false`, `deliveryEnabled: !!c.deliveryEnabled`, `deliveryFee/minOrder/prepEtaMinutes: Math.max(0, Number(… ?? 0)) || 0`, `serviceAreaNote: String(… ?? "").slice(0,300)`). `merge: true` therefore protects only *unknown* fields — every field the op names is overwritten with a default when the body omits it. The new dialog MUST fetch the full current config first and submit the full object back (including `pickupEnabled`/`deliveryEnabled`, which this dialog does not edit), or it will silently reset delivery's on/off state set by the `set-delivery-enabled` toggle shipped earlier today. Do not "simplify" this to a partial submit, and do not assume `merge: true` makes a partial submit safe — it does not.
- **`deliveryEnabled` is opt-OUT everywhere it is READ, but opt-IN where `set-config` WRITES it.** Reads use `cfg.deliveryEnabled !== false` (`Shareat Website/functions/index.js:140`, `POS/.../OnlineOrdersClient.tsx:414`) — an absent field means *enabled*, which is the state almost every store is in right now, because until today nothing ever wrote the field. `set-config` writes `!!c.deliveryEnabled` — an absent field means *disabled*. Any new code that round-trips this field must read it with `!== false`, never with `!!`, or opening and saving a dialog silently switches delivery off for every store that never touched the pause toggle.
- `set-config` and `get` on that route are already gated to `admin`/`manager` only (explicit `if (!isManagerOrAbove) return bad("Manager access required for this action.", 403);` at `route.ts:44` and `:69`; `isManagerOrAbove` is `staff.isPlatformAdmin || staff.role === "manager"` at `:40`) — reuse that, do not widen it.
- Money and minute fields are plain numbers in Firestore (`deliveryFee`, `minOrder`, `prepEtaMinutes` — pesos and minutes respectively, not cents/ms). Match existing precedent; do not introduce a different unit.
- **The prep-time ETA is a nice-to-have; the catalog it rides on is not.** `getStorefrontCatalog` is the endpoint that renders the entire online menu. Its outer `catch` returns a 500, so an unhandled throw from the new ticket-count query (missing/still-building index ⇒ `FAILED_PRECONDITION`, or a hub permissions change) would take the whole storefront down. The count query MUST be wrapped so a failure degrades to the plain baseline, never to a 500.

---

## File Structure

**Shareat Website:**
- Modify: `functions/index.js` — add `dynamicPrepEtaMinutes()` (pure formula) and `computePrepEtaMinutes()` (Firestore I/O wrapper) near `onlineOpenNow`/`readOnlineStore`; wire into `getStorefrontCatalog`'s response.
- Modify: `tests/helpers/firestore-stub.cjs` — add `collectionGroup(name)` + `.count()` support (currently the stub only supports single-collection `.collection(path)` queries).
- Create: `tests/storefront-catalog.functions.test.cjs` — covers the dynamic prep-time behavior end-to-end through the real `getStorefrontCatalog` handler.
- Modify: `src/scripts/shop-checkout.ts` — add `prepEtaMinutes` to the `Config` type and display it in `applyConfigToUI()`.
- Modify: `src/pages/shop/checkout.astro` — add the `#checkout-prep-eta` element.

**POS:**
- Create: `src/lib/storefront/delivery-config.ts` — pure `sanitizeDeliveryConfig()` used by the new dialog to clamp/validate input before submit.
- Create: `src/lib/storefront/delivery-config.test.ts` — Vitest coverage for the sanitizer.
- Create: `src/components/admin/online-orders/DeliveryPricingSettings.tsx` — the admin/manager-only dialog.
- Modify: `src/components/admin/online-orders/OnlineOrdersClient.tsx` — add a "Delivery & Pricing…" button (admin/manager only) that opens the dialog.
- Modify: `firestore.indexes.json` — add the `COLLECTION_GROUP`-scoped `kitchentickets` index the new count query needs (see Task 7; the existing `kitchentickets` entries are all `COLLECTION`-scoped and cannot serve a `collectionGroup()` query).

---

### Task 1: Extend the Firestore test stub with collectionGroup + count()

**Files:**
- Modify: `C:\Users\ianla\webapps\Shareat Website\tests\helpers\firestore-stub.cjs`
- Test: `C:\Users\ianla\webapps\Shareat Website\tests\firestore-stub-collectiongroup.test.cjs`

**Interfaces:**
- Produces: `Db.collectionGroup(name: string)` returning an object with `.where(field, op, value)` (chainable, `==` only) and `.count()` returning `{ get: () => Promise<{ data: () => { count: number } }> }`. Matches the real `firebase-admin` Firestore `Query.count().get()` shape used in Task 2.

- [ ] **Step 1: Write the failing test**

```js
// tests/firestore-stub-collectiongroup.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { Db } = require("./helpers/firestore-stub.cjs");

test("collectionGroup finds docs under that collection name regardless of parent path", async () => {
  const db = new Db("test");
  db.reset({
    "stores/S1/sessions/A/kitchentickets/t1": { storeId: "S1", status: "preparing" },
    "stores/S1/onlineOrders/B/kitchentickets/t2": { storeId: "S1", status: "preparing" },
    "stores/S1/sessions/A/kitchentickets/t3": { storeId: "S1", status: "served" },
    "stores/S2/sessions/C/kitchentickets/t4": { storeId: "S2", status: "preparing" },
  });

  const snap = await db
    .collectionGroup("kitchentickets")
    .where("storeId", "==", "S1")
    .where("status", "==", "preparing")
    .count()
    .get();

  assert.equal(snap.data().count, 2);
});

test("collectionGroup count is 0 when nothing matches", async () => {
  const db = new Db("test");
  db.reset({ "stores/S1/sessions/A/kitchentickets/t1": { storeId: "S1", status: "served" } });

  const snap = await db.collectionGroup("kitchentickets").where("storeId", "==", "S1").where("status", "==", "preparing").count().get();

  assert.equal(snap.data().count, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/firestore-stub-collectiongroup.test.cjs`
Expected: FAIL — `TypeError: db.collectionGroup is not a function`

- [ ] **Step 3: Implement the stub extension**

In `firestore-stub.cjs`, add a `_allOfCollectionGroup` helper to `Db` (mirrors the existing `_childrenOf`) and a `collectionGroup()` method, plus a small `CollectionGroupRef` class:

```js
// Add inside class Db, next to _childrenOf(path):
  // Every doc whose immediate parent collection is named `name`, anywhere
  // in the tree (e.g. both stores/S/sessions/X/kitchentickets/T and
  // stores/S/onlineOrders/Y/kitchentickets/T match "kitchentickets").
  _allOfCollectionGroup(name) {
    const out = [];
    for (const [p, data] of this.docs) {
      const segs = p.split("/");
      if (segs.length >= 2 && segs[segs.length - 2] === name) {
        out.push({ id: segs[segs.length - 1], path: p, data });
      }
    }
    return out;
  }

  collectionGroup(name) {
    return new CollectionGroupRef(this, name);
  }
```

Add the new class immediately after the `Db` class's closing brace (before `class DocRef`). Definition order does not matter — `CollectionGroupRef` is only referenced from inside a method body that runs long after module evaluation — but keeping it next to `Db` puts it beside the method that vends it. Note the `_touch` label `(group)kitchentickets`: Task 2's degradation test matches that exact string with `hubDb.forbid`, so do not change it.

```js
class CollectionGroupRef {
  constructor(db, name, filters = []) {
    this.db = db;
    this.name = name;
    this._filters = filters;
  }

  where(field, op, value) {
    return new CollectionGroupRef(this.db, this.name, [...this._filters, { field, op, value }]);
  }

  count() {
    return {
      get: async () => {
        this.db._touch("count", `(group)${this.name}`);
        await tick(); // same yield the other reads use (module-level helper, line ~19)
        let rows = this.db._allOfCollectionGroup(this.name);
        for (const f of this._filters) {
          rows = rows.filter((r) => {
            if (f.op !== "==") throw new Error(`stub: unsupported operator ${f.op}`);
            return r.data[f.field] === f.value;
          });
        }
        return { data: () => ({ count: rows.length }) };
      },
    };
  }
}
```

Update the final export line:

```js
module.exports = { Db, SERVER_TIMESTAMP, increment, tsFromMillis };
```

(unchanged — `CollectionGroupRef` is internal, reached only via `db.collectionGroup()`, same pattern as `CollRef`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/firestore-stub-collectiongroup.test.cjs`
Expected: PASS (2/2)

- [ ] **Step 5: Run the full existing suite to confirm no regression**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/*.functions.test.cjs tests/firestore-stub-collectiongroup.test.cjs`
Expected: PASS (all — 71 pre-existing + 2 new = 73)

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ianla\webapps\Shareat Website"
git add tests/helpers/firestore-stub.cjs tests/firestore-stub-collectiongroup.test.cjs
git commit -m "test: add collectionGroup + count() support to the Firestore stub"
```

---

### Task 2: Dynamic prep-time computation, wired into getStorefrontCatalog

**Files:**
- Modify: `C:\Users\ianla\webapps\Shareat Website\functions\index.js`
- Test: `C:\Users\ianla\webapps\Shareat Website\tests\storefront-catalog.functions.test.cjs`

**Interfaces:**
- Consumes: `Task 1`'s `hubDb.collectionGroup(name).where(...).where(...).count().get()`.
- Produces: `getStorefrontCatalog`'s JSON response `config.prepEtaMinutes` is now the load-adjusted value, not the raw stored baseline. No other response field changes shape.

- [ ] **Step 1: Write the failing test**

```js
// tests/storefront-catalog.functions.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFunctions, hubDb, siteDb, call } = require("./helpers/load-functions.cjs");

test("getStorefrontCatalog: baseline prep time with zero active tickets", async () => {
  const fns = loadFunctions();
  siteDb.reset({});
  hubDb.reset({
    "stores/S1": { name: "SharEat", address: "x", acceptsOnlineOrders: true, onlineOrderMode: "manual", onlineOrderManualOpen: true, geo: { lat: 1, lng: 1 } },
    "stores/S1/storefrontCatalog/main": { categories: [], currency: "PHP" },
    "stores/S1/storefrontConfig/main": { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 50, minOrder: 200, prepEtaMinutes: 15, serviceAreaNote: "" },
  });

  const res = await call(fns.getStorefrontCatalog, {}, { query: { storeId: "S1" } });

  assert.equal(res.body.ok, true);
  assert.equal(res.body.config.prepEtaMinutes, 15); // 0 active tickets -> baseline only
});

test("getStorefrontCatalog: prep time bumps with active tickets, capped, only counts 'preparing'", async () => {
  const fns = loadFunctions();
  siteDb.reset({});
  hubDb.reset({
    "stores/S1": { name: "SharEat", address: "x", acceptsOnlineOrders: true, onlineOrderMode: "manual", onlineOrderManualOpen: true, geo: { lat: 1, lng: 1 } },
    "stores/S1/storefrontCatalog/main": { categories: [], currency: "PHP" },
    "stores/S1/storefrontConfig/main": { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 50, minOrder: 200, prepEtaMinutes: 15, serviceAreaNote: "" },
    // 5 active tickets across both a dine-in session and an online order for S1 -> +5 min (5 * 1, under the 20 cap)
    "stores/S1/sessions/A/kitchentickets/t1": { storeId: "S1", status: "preparing" },
    "stores/S1/sessions/A/kitchentickets/t2": { storeId: "S1", status: "preparing" },
    "stores/S1/onlineOrders/B/kitchentickets/t3": { storeId: "S1", status: "preparing" },
    "stores/S1/onlineOrders/B/kitchentickets/t4": { storeId: "S1", status: "preparing" },
    "stores/S1/onlineOrders/B/kitchentickets/t5": { storeId: "S1", status: "preparing" },
    // must NOT count: wrong status, wrong store
    "stores/S1/sessions/A/kitchentickets/t6": { storeId: "S1", status: "ready" },
    "stores/S1/sessions/A/kitchentickets/t7": { storeId: "S1", status: "served" },
    "stores/S2/sessions/Z/kitchentickets/t8": { storeId: "S2", status: "preparing" },
  });

  const res = await call(fns.getStorefrontCatalog, {}, { query: { storeId: "S1" } });

  assert.equal(res.body.config.prepEtaMinutes, 20); // 15 baseline + 5
});

test("getStorefrontCatalog: bonus is capped even with a huge ticket count", async () => {
  const fns = loadFunctions();
  siteDb.reset({});
  const seed = {
    "stores/S1": { name: "SharEat", address: "x", acceptsOnlineOrders: true, onlineOrderMode: "manual", onlineOrderManualOpen: true, geo: { lat: 1, lng: 1 } },
    "stores/S1/storefrontCatalog/main": { categories: [], currency: "PHP" },
    "stores/S1/storefrontConfig/main": { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 50, minOrder: 200, prepEtaMinutes: 15, serviceAreaNote: "" },
  };
  for (let i = 0; i < 50; i++) seed[`stores/S1/sessions/A/kitchentickets/t${i}`] = { storeId: "S1", status: "preparing" };
  hubDb.reset(seed);

  const res = await call(fns.getStorefrontCatalog, {}, { query: { storeId: "S1" } });

  assert.equal(res.body.config.prepEtaMinutes, 35); // 15 baseline + 20 cap, not 15 + 50
});

test("getStorefrontCatalog: prep time stays 0 when no baseline is configured (opted out)", async () => {
  const fns = loadFunctions();
  siteDb.reset({});
  hubDb.reset({
    "stores/S1": { name: "SharEat", address: "x", acceptsOnlineOrders: true, onlineOrderMode: "manual", onlineOrderManualOpen: true, geo: { lat: 1, lng: 1 } },
    "stores/S1/storefrontCatalog/main": { categories: [], currency: "PHP" },
    "stores/S1/storefrontConfig/main": { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 0, minOrder: 0, serviceAreaNote: "" }, // no prepEtaMinutes
    "stores/S1/sessions/A/kitchentickets/t1": { storeId: "S1", status: "preparing" },
  });

  const res = await call(fns.getStorefrontCatalog, {}, { query: { storeId: "S1" } });

  assert.equal(res.body.config.prepEtaMinutes, 0);
});

// The ETA is a nicety; the catalog is the whole online menu. If the count
// query throws (index still building ⇒ FAILED_PRECONDITION, hub creds
// changed, …) the endpoint must still serve the menu with the plain
// baseline — NOT fall through to the handler's outer catch and 500.
// `forbid` is the stub's existing "prove this path throws" hook; the label
// it matches is the one CollectionGroupRef._touch writes in Task 1.
test("getStorefrontCatalog: a failing ticket-count degrades to the baseline, not a 500", async () => {
  const fns = loadFunctions();
  siteDb.reset({});
  hubDb.reset({
    "stores/S1": { name: "SharEat", address: "x", acceptsOnlineOrders: true, onlineOrderMode: "manual", onlineOrderManualOpen: true, geo: { lat: 1, lng: 1 } },
    "stores/S1/storefrontCatalog/main": { categories: [], currency: "PHP" },
    "stores/S1/storefrontConfig/main": { pickupEnabled: true, deliveryEnabled: true, prepEtaMinutes: 15 },
  });
  hubDb.forbid = /^\(group\)kitchentickets$/; // set AFTER reset() — reset clears it

  const res = await call(fns.getStorefrontCatalog, {}, { query: { storeId: "S1" } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.config.prepEtaMinutes, 15);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/storefront-catalog.functions.test.cjs`
Expected: FAIL on the second and third tests — current code returns the raw baseline (15), not the bumped value (20 / 35). Tests 1 and 4 pass already (the current static line happens to produce the right number for those two inputs); test 5 passes vacuously today (nothing queries tickets yet) and only becomes meaningful once Step 3 adds the query.

- [ ] **Step 3: Implement the formula + I/O wrapper**

In `functions/index.js`, insert immediately **before** `function onlineOpenNow(s) {` (currently line 106) — that puts it inside the storefront-helpers block, above `readOnlineStore`/`resolveStoreId` and well after the `REGION`/`HUB_SA_KEY`/`SITE_ORIGIN` declarations at lines 24-47:

```js
// Kitchen-load-aware prep time. A manager sets a baseline (storefrontConfig/
// main.prepEtaMinutes); this adds a bonus proportional to how many tickets
// are currently being cooked for the store, capped so a slammed kitchen
// doesn't show a scary/implausible ETA. Tune the two constants below by
// watching real order volume — they are a starting guess, not measured.
const PREP_TIME_MINUTES_PER_ACTIVE_TICKET = 1;
const PREP_TIME_MAX_BONUS_MINUTES = 20;

// Pure — no Firestore. `activeTicketCount` is however many kitchentickets
// are currently status:"preparing" for the store. (The POS KDS itself treats
// "preparing" OR "partially_served" as its active bucket — see POS
// src/app/kitchen/page.tsx:924. Counting only "preparing" is deliberate: a
// partially-served ticket is already half-cooked, so weighting it the same
// as a fresh one would overstate load. Revisit if ETAs read low in practice.)
function dynamicPrepEtaMinutes(baselineMinutes, activeTicketCount) {
  const baseline = Number(baselineMinutes) || 0;
  if (baseline <= 0) return 0; // manager hasn't opted into showing an ETA at all
  const count = Math.max(0, Number(activeTicketCount) || 0);
  const bonus = Math.min(PREP_TIME_MAX_BONUS_MINUTES, count * PREP_TIME_MINUTES_PER_ACTIVE_TICKET);
  return Math.round(baseline + bonus);
}

// Reads the live active-ticket count (collectionGroup spans both dine-in
// sessions/*/kitchentickets and onlineOrders/*/kitchentickets — one shared
// kitchen cooks both) and applies the formula above. Skips the query
// entirely when there's no baseline, since the result would be discarded.
// NEVER throws: this endpoint serves the whole online menu, and a missing or
// still-building COLLECTION_GROUP index raises FAILED_PRECONDITION. Losing
// the load bump is acceptable; losing the catalog is not.
async function computePrepEtaMinutes(hubDb, storeId, baselineMinutes) {
  if (!(Number(baselineMinutes) > 0)) return 0;
  try {
    const snap = await hubDb
      .collectionGroup("kitchentickets")
      .where("storeId", "==", storeId)
      .where("status", "==", "preparing")
      .count()
      .get();
    return dynamicPrepEtaMinutes(baselineMinutes, snap.data().count || 0);
  } catch (e) {
    console.error("computePrepEtaMinutes: ticket count failed, falling back to baseline:", e && e.message);
    return dynamicPrepEtaMinutes(baselineMinutes, 0);
  }
}
```

Then in `exports.getStorefrontCatalog` (currently line 1491, the only occurrence of `prepEtaMinutes` in the file — verified, so the replace is unambiguous), replace the static line:

```js
          prepEtaMinutes: Number(cfg.prepEtaMinutes || 0),
```

with:

```js
          prepEtaMinutes: await computePrepEtaMinutes(hubDb, storeId, cfg.prepEtaMinutes),
```

(`hubDb` and `storeId` are already in scope in that handler — `const hubDb = getHubDb();` at line 1459 and `const storeId = await resolveStoreId(...)` at line 1460. `await` inside the `res.json({...})` object literal is fine; the handler is already `async`.)

Note this adds one extra sequential round-trip *after* the existing `Promise.all` of three reads. That is deliberate — the count depends on `storeId`, which the `Promise.all` block does not — and one extra indexed aggregation read is cheap. Do not try to fold it into the `Promise.all`; `cfg.prepEtaMinutes` isn't known until that block resolves.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/storefront-catalog.functions.test.cjs`
Expected: PASS (5/5)

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && node --test tests/*.functions.test.cjs tests/firestore-stub-collectiongroup.test.cjs`
Expected: PASS (78 = 71 pre-existing + 2 from Task 1 + 5 from this task)

- [ ] **Step 6: Commit**

```bash
cd "C:\Users\ianla\webapps\Shareat Website"
git add functions/index.js tests/storefront-catalog.functions.test.cjs
git commit -m "feat: make storefront prep-time ETA scale with active kitchen tickets"
```

---

### Task 3: Show the prep-time ETA on the checkout page

**Files:**
- Modify: `C:\Users\ianla\webapps\Shareat Website\src\scripts\shop-checkout.ts`
- Modify: `C:\Users\ianla\webapps\Shareat Website\src\pages\shop\checkout.astro`

**Interfaces:**
- Consumes: `config.prepEtaMinutes` (number, minutes; 0 = don't show) already returned by `getStorefrontCatalog` after Task 2.

No existing test file covers `shop-checkout.ts`'s DOM logic (`applyConfigToUI`, `renderSummary`, etc. are all untested today — verified: no `shop-checkout*.test.*` file exists). This task follows that existing precedent and is verified manually in Task 7, not with an automated test.

- [ ] **Step 1: Add the element to checkout.astro**

In `src/pages/shop/checkout.astro`, right after the existing `#checkout-service-note` element:

```html
                <p id="checkout-service-note" class="hidden text-xs text-shareat-black/60"></p>
                <p id="checkout-prep-eta" class="hidden text-xs text-shareat-black/60"></p>
```

- [ ] **Step 2: Extend the Config type and default**

In `src/scripts/shop-checkout.ts`:

```ts
type Config = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFee: number;
  minOrder: number;
  serviceAreaNote: string;
  prepEtaMinutes: number;
};

let config: Config = { pickupEnabled: true, deliveryEnabled: false, deliveryFee: 0, minOrder: 0, serviceAreaNote: "", prepEtaMinutes: 0 };
```

- [ ] **Step 3: Render it in applyConfigToUI()**

In the same file, in `applyConfigToUI()`, right after the existing `serviceAreaNote` block:

```ts
  const note = $("checkout-service-note");
  if (note && config.serviceAreaNote) {
    note.textContent = config.serviceAreaNote;
    note.classList.remove("hidden");
  }
  const prepEta = $("checkout-prep-eta");
  if (prepEta) {
    if (config.prepEtaMinutes > 0) {
      prepEta.textContent = `Ready in about ${config.prepEtaMinutes} min`;
      prepEta.classList.remove("hidden");
    } else {
      prepEta.classList.add("hidden");
    }
  }
  toggleAddress();
```

- [ ] **Step 4: Manual smoke test**

Run: `cd "C:\Users\ianla\webapps\Shareat Website" && npm run dev`, open `/shop/checkout` for a store with `prepEtaMinutes` set (seed via the Task 6 dialog once it exists, or set it directly on `storefrontConfig/main` in the Firestore console for now), confirm the "Ready in about N min" line appears under the delivery/pickup note.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\ianla\webapps\Shareat Website"
git add src/scripts/shop-checkout.ts src/pages/shop/checkout.astro
git commit -m "feat: display the prep-time ETA on checkout"
```

---

### Task 4: POS — pure config sanitizer

**Files:**
- Create: `C:\Users\ianla\webapps\POS\src\lib\storefront\delivery-config.ts`
- Test: `C:\Users\ianla\webapps\POS\src\lib\storefront\delivery-config.test.ts`

**Interfaces:**
- Produces: `sanitizeDeliveryConfig(input: DeliveryConfigInput): DeliveryConfig` — used by Task 5's dialog before submit. `DeliveryConfig = { deliveryFee: number; minOrder: number; prepEtaMinutes: number; serviceAreaNote: string }`. `DeliveryConfigInput` is the same shape but every field optional/possibly-a-string (raw form state).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/storefront/delivery-config.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeDeliveryConfig } from "./delivery-config";

describe("sanitizeDeliveryConfig", () => {
  it("clamps negative numbers to 0", () => {
    expect(sanitizeDeliveryConfig({ deliveryFee: -5, minOrder: -1, prepEtaMinutes: -10, serviceAreaNote: "" }))
      .toEqual({ deliveryFee: 0, minOrder: 0, prepEtaMinutes: 0, serviceAreaNote: "" });
  });

  it("coerces string numbers from form inputs", () => {
    expect(sanitizeDeliveryConfig({ deliveryFee: "50", minOrder: "200", prepEtaMinutes: "15", serviceAreaNote: "Lipa only" } as any))
      .toEqual({ deliveryFee: 50, minOrder: 200, prepEtaMinutes: 15, serviceAreaNote: "Lipa only" });
  });

  it("defaults missing/invalid numbers to 0", () => {
    expect(sanitizeDeliveryConfig({ deliveryFee: undefined, minOrder: NaN, prepEtaMinutes: "abc" as any, serviceAreaNote: undefined as any }))
      .toEqual({ deliveryFee: 0, minOrder: 0, prepEtaMinutes: 0, serviceAreaNote: "" });
  });

  it("truncates serviceAreaNote to 300 chars, matching the server", () => {
    const long = "x".repeat(400);
    const result = sanitizeDeliveryConfig({ deliveryFee: 0, minOrder: 0, prepEtaMinutes: 0, serviceAreaNote: long });
    expect(result.serviceAreaNote).toHaveLength(300);
  });

  it("rounds fractional minutes/pesos to whole numbers", () => {
    expect(sanitizeDeliveryConfig({ deliveryFee: 49.6, minOrder: 199.4, prepEtaMinutes: 14.5, serviceAreaNote: "" }))
      .toEqual({ deliveryFee: 50, minOrder: 199, prepEtaMinutes: 15, serviceAreaNote: "" }); // Math.round: 49.6->50, 199.4->199, 14.5->15
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\ianla\webapps\POS" && npx vitest run src/lib/storefront/delivery-config.test.ts`
Expected: FAIL — `Failed to resolve import "./delivery-config"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/storefront/delivery-config.ts

/** Raw, possibly-string form state for the delivery/pricing config dialog. */
export type DeliveryConfigInput = {
  deliveryFee?: number | string;
  minOrder?: number | string;
  prepEtaMinutes?: number | string;
  serviceAreaNote?: string;
};

export type DeliveryConfig = {
  deliveryFee: number;
  minOrder: number;
  prepEtaMinutes: number;
  serviceAreaNote: string;
};

function clampNonNegativeInt(v: number | string | undefined): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Clamps raw form text before it is submitted to set-config
 * (POS/src/app/api/admin/storefront-catalog/route.ts:68-83). Deliberately
 * STRICTER than the server, not a mirror of it: the server does
 * `Math.max(0, Number(x ?? 0)) || 0` and would happily store 49.6, while this
 * rounds to whole pesos/minutes first. Whole numbers only is the product
 * decision here (no ₱49.50 delivery fees) — because the client rounds before
 * the round trip, what the server stores still equals what the dialog shows.
 */
export function sanitizeDeliveryConfig(input: DeliveryConfigInput): DeliveryConfig {
  return {
    deliveryFee: clampNonNegativeInt(input.deliveryFee),
    minOrder: clampNonNegativeInt(input.minOrder),
    prepEtaMinutes: clampNonNegativeInt(input.prepEtaMinutes),
    serviceAreaNote: String(input.serviceAreaNote ?? "").slice(0, 300),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:\Users\ianla\webapps\POS" && npx vitest run src/lib/storefront/delivery-config.test.ts`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\ianla\webapps\POS"
git add src/lib/storefront/delivery-config.ts src/lib/storefront/delivery-config.test.ts
git commit -m "Add pure sanitizer for the delivery/pricing config dialog"
```

---

### Task 5: POS — the Delivery & Pricing dialog

**Files:**
- Create: `C:\Users\ianla\webapps\POS\src\components\admin\online-orders\DeliveryPricingSettings.tsx`

**Interfaces:**
- Consumes: `sanitizeDeliveryConfig` from Task 4. Calls `POST /api/admin/storefront-catalog` with `op: "get"` (read) and `op: "set-config"` (write) — both already implemented and manager-gated server-side (today's earlier commit).
- Produces: `<DeliveryPricingSettings storeId={string} open={boolean} onClose={() => void} />` — a self-contained dialog that does its own fetch and its own save; no props thread form state or a save handler back to the parent. The exact `open` + `onClose` pair matches `src/components/cashier/CashierTipModal.tsx:8-10`; `open` + `onOpenChange(next)` is the other common shape here (`OptionGroupEditDialog`, `product-merge-dialog`, `modifier-picker`). Do **not** copy `StoreEditDialog` (`src/components/admin/store-edit-dialog.tsx:98`) — it takes `isOpen`/`onClose`/`onSave`/`isSubmitting` and leaves persistence to its parent, which is the opposite of what this dialog does.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { sanitizeDeliveryConfig, type DeliveryConfig } from "@/lib/storefront/delivery-config";

// Full raw config as stored on stores/{storeId}/storefrontConfig/main. Wider
// than DeliveryConfig — pickupEnabled/deliveryEnabled are NOT edited by this
// dialog (they're owned by the separate on/off switches on the Online Orders
// page header) but MUST be read and re-submitted unchanged. set-config
// rebuilds every field it knows about from the request body, defaulting the
// ones the body omits, so `merge: true` does not protect them: dropping these
// two here would silently turn delivery/pickup back on/off.
type FullConfig = DeliveryConfig & { pickupEnabled: boolean; deliveryEnabled: boolean };

// Both booleans default to TRUE here, matching how every READER of this doc
// interprets an absent field (functions/index.js:140-141,
// OnlineOrdersClient.tsx:414 — both `!== false`). Defaulting deliveryEnabled
// to false would be the opt-in reading that set-config writes, and using it
// here would turn delivery OFF for every store that has never touched the
// pause toggle — which is almost all of them, since nothing wrote the field
// before today. This value is only reached if the load fails, and `loadError`
// blocks saving in that case, but it must still be the safe default.
const EMPTY: FullConfig = {
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFee: 0,
  minOrder: 0,
  prepEtaMinutes: 0,
  serviceAreaNote: "",
};

const EMPTY_FORM = { deliveryFee: "0", minOrder: "0", prepEtaMinutes: "0", serviceAreaNote: "" };

export function DeliveryPricingSettings({
  storeId,
  open,
  onClose,
}: {
  storeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuthContext();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<FullConfig>(EMPTY);
  const [form, setForm] = useState(EMPTY_FORM);

  // Refetches on every open (`open` is a dep), and resets both config and the
  // form to a clean slate first, so a second open can never show — or submit —
  // values left over from a previous open of a different store.
  useEffect(() => {
    if (!open || !storeId) return;
    let cancelled = false;
    setConfig(EMPTY);
    setForm(EMPTY_FORM);
    setLoadError(null);
    setLoading(true);
    (async () => {
      try {
        const u = user || getAuth().currentUser;
        if (!u) throw new Error("Not signed in.");
        const idToken = await u.getIdToken();
        const res = await fetch("/api/admin/storefront-catalog", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ op: "get", storeId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || `Load failed (${res.status})`);
        const c: Partial<FullConfig> = json.config || {};
        const full: FullConfig = {
          // BOTH booleans read with `!== false` — the opt-out reading every
          // other consumer of this doc uses. `!!c.deliveryEnabled` here would
          // silently disable delivery on save for any store whose config doc
          // has no deliveryEnabled field yet. See Global Constraints.
          pickupEnabled: c.pickupEnabled !== false,
          deliveryEnabled: c.deliveryEnabled !== false,
          deliveryFee: Number(c.deliveryFee) || 0,
          minOrder: Number(c.minOrder) || 0,
          prepEtaMinutes: Number(c.prepEtaMinutes) || 0,
          serviceAreaNote: String(c.serviceAreaNote || ""),
        };
        if (cancelled) return;
        setConfig(full);
        setForm({
          deliveryFee: String(full.deliveryFee),
          minOrder: String(full.minOrder),
          prepEtaMinutes: String(full.prepEtaMinutes),
          serviceAreaNote: full.serviceAreaNote,
        });
      } catch (e: any) {
        if (!cancelled) {
          // Record it, not just toast it: saving on top of a failed load would
          // write EMPTY over the store's real fee/minOrder. Save stays disabled.
          setLoadError(e?.message || "Could not load settings.");
          toast({ variant: "destructive", title: "Could not load settings", description: e?.message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, storeId, user, toast]);

  const handleSave = async () => {
    if (saving || loadError) return;
    const clean = sanitizeDeliveryConfig(form);
    setSaving(true);
    try {
      const u = user || getAuth().currentUser;
      if (!u) throw new Error("Not signed in.");
      const idToken = await u.getIdToken();
      // Full object, including the two fields this dialog never shows — see
      // the FullConfig comment above for why that's required.
      const payload: FullConfig = { ...config, ...clean };
      const res = await fetch("/api/admin/storefront-catalog", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "set-config", storeId, config: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
      toast({ title: "Delivery & pricing settings saved" });
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not save settings", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delivery & Pricing</DialogTitle>
          <DialogDescription>
            Fee, minimum order, and prep-time baseline for this branch's online orders. The prep time shown to
            customers is this baseline plus a live bump for how busy the kitchen currently is.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : loadError ? (
          <div className="py-6 text-center text-sm text-destructive">
            {loadError}
            <p className="mt-1 text-xs text-muted-foreground">Close and reopen to try again — saving is disabled so nothing gets overwritten.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="deliveryFee">Delivery fee (₱)</Label>
              <Input
                id="deliveryFee"
                inputMode="decimal"
                value={form.deliveryFee}
                onChange={(e) => setForm((f) => ({ ...f, deliveryFee: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="minOrder">Minimum order (₱)</Label>
              <Input
                id="minOrder"
                inputMode="decimal"
                value={form.minOrder}
                onChange={(e) => setForm((f) => ({ ...f, minOrder: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prepEtaMinutes">Baseline prep time (minutes)</Label>
              <Input
                id="prepEtaMinutes"
                inputMode="numeric"
                value={form.prepEtaMinutes}
                onChange={(e) => setForm((f) => ({ ...f, prepEtaMinutes: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">0 = don't show a prep-time estimate to customers.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serviceAreaNote">Service area note</Label>
              <Textarea
                id="serviceAreaNote"
                rows={2}
                maxLength={300}
                value={form.serviceAreaNote}
                onChange={(e) => setForm((f) => ({ ...f, serviceAreaNote: e.target.value }))}
                placeholder="e.g. Delivery covers Lipa proper only"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={loading || saving || !!loadError}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "C:\Users\ianla\webapps\POS" && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\ianla\webapps\POS"
git add src/components/admin/online-orders/DeliveryPricingSettings.tsx
git commit -m "Add Delivery & Pricing settings dialog"
```

---

### Task 6: Wire the dialog into the Online Orders page

**Files:**
- Modify: `C:\Users\ianla\webapps\POS\src\components\admin\online-orders\OnlineOrdersClient.tsx`

**Interfaces:**
- Consumes: `DeliveryPricingSettings` from Task 5.

- [ ] **Step 1: Import it and add open-state**

`Settings2` goes into the **existing** lucide-react import (currently line 21) — do not add a second `from "lucide-react"` line:

```tsx
import { Loader2, ShoppingBag, MapPin, Phone, Mail, Truck, Store as StoreIcon, MessageCircle, Settings2 } from "lucide-react";
```

Then, next to the sibling component imports (after the `DeliveryAvailabilityControl` import, currently line 24):

```tsx
import { DeliveryPricingSettings } from "@/components/admin/online-orders/DeliveryPricingSettings";
```

Next to the existing `canToggleAvailability` line (currently line 194) — the file has no `isManagerOrAbove` today, so the name is free, and it deliberately reads the same way as the server's `isManagerOrAbove` in `route.ts:40`:

```tsx
  const isManagerOrAbove = appUser?.role === "admin" || appUser?.role === "manager";
```

Near the other `useState` declarations (line 196 onward):

```tsx
  const [pricingOpen, setPricingOpen] = useState(false);
```

`appUser` is already destructured from `useAuthContext()` at line 187, `Button` is already imported at line 14, and `UserRole` is `'admin' | 'manager' | 'cashier' | 'kitchen' | 'server' | 'pending'` — so the two-value check is exhaustive for "manager or above."

- [ ] **Step 2: Add the trigger button to the PageHeader, admin/manager only**

Right before the `<ShoppingBag className="h-6 w-6 text-muted-foreground" />` line inside `PageHeader` (currently line 595). `PageHeader` wraps its children in `flex items-center gap-2` (`src/components/page-header.tsx:21`), so the button sits inline with the two existing availability controls:

```tsx
          {storeId && isManagerOrAbove && (
            <Button variant="outline" size="sm" onClick={() => setPricingOpen(true)}>
              <Settings2 className="mr-2 h-4 w-4" /> Delivery & Pricing
            </Button>
          )}
          <ShoppingBag className="h-6 w-6 text-muted-foreground" />
```

- [ ] **Step 3: Render the dialog**

Between the order-detail dialog's closing `</Dialog>` (currently line 897) and the closing `</RoleGuard>` (line 898). `RoleGuard` already takes two children there (`<div className="container …">` + `<Dialog>`), so adding a third needs no fragment:

```tsx
      {storeId && (
        <DeliveryPricingSettings storeId={storeId} open={pricingOpen} onClose={() => setPricingOpen(false)} />
      )}
```

- [ ] **Step 4: Typecheck and run the existing test file**

Run: `cd "C:\Users\ianla\webapps\POS" && npx tsc --noEmit && npx vitest run src/components/admin/online-orders/OnlineOrdersClient.test.ts`
Expected: both clean/passing.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\ianla\webapps\POS"
git add src/components/admin/online-orders/OnlineOrdersClient.tsx
git commit -m "Wire the Delivery & Pricing dialog into the Online Orders page"
```

---

### Task 7: Firestore index, deploy checklist, and live verification

**Files:**
- Modify: `C:\Users\ianla\webapps\POS\firestore.indexes.json`

- [ ] **Step 1: Add the COLLECTION_GROUP index the new query requires**

**A new index IS needed.** `POS/firestore.indexes.json` does contain a `kitchentickets` composite index on `storeId`+`status`+`createdAt` — but every entry in that file, including that one, is `"queryScope": "COLLECTION"`, and `fieldOverrides` is `[]`. A `COLLECTION`-scoped index only serves queries against one specific collection path (`stores/S1/sessions/A/kitchentickets`); it cannot serve a `collectionGroup()` query at all. Collection-group queries require a `COLLECTION_GROUP`-scoped index, and Firestore's automatic single-field indexing does not create those.

Add this entry to the `indexes` array (equality-only, so no `createdAt` field is needed — two equality filters are the whole query):

```json
    {
      "collectionGroup": "kitchentickets",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "storeId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    }
```

Deploy it from the POS repo (`.firebaserc` default project is `shareat-hub-v2`, and `firebase.json` points `firestore.indexes` at this file):

```bash
cd "C:\Users\ianla\webapps\POS"
firebase deploy --only firestore:indexes
```

Commit the file change (this is the one part of Task 7 that is a code change, not an operation):

```bash
cd "C:\Users\ianla\webapps\POS"
git add firestore.indexes.json
git commit -m "Add COLLECTION_GROUP kitchentickets index for the storefront prep-time count"
```

Three cautions:
- **"Deploy complete!" ≠ ready.** Open the Firebase console for `shareat-hub-v2` → Firestore → Indexes and wait for this index to show **Enabled**, not "Building." Until then the query raises `FAILED_PRECONDITION` (which Task 2's `try/catch` degrades to the plain baseline — the storefront stays up, the load bump just does nothing).
- **`firestore.indexes.json` is known to be out of sync with the live project.** `src/lib/server/analytics/backfillServer.ts:51` already runs `collectionGroup("kitchentickets").where("storeId","==",…)` with a `createdAt` range, which is impossible without a `COLLECTION_GROUP` index that is *not* in this file — meaning at least one index was created via the console error link and never captured here. Review the CLI's diff output before confirming, and do not accept any prompt offering to delete indexes that are not in the file.
- POS deploys are Ian's call, not this plan's (same rule as Step 3): make the file change and commit it, then hand the `firebase deploy` off rather than running it.

- [ ] **Step 2: Build and deploy the website**

```bash
cd "C:\Users\ianla\webapps\Shareat Website"
npm run build
node --test tests/*.functions.test.cjs tests/firestore-stub-collectiongroup.test.cjs
firebase deploy --only hosting
firebase deploy --only functions:getStorefrontCatalog
```

- [ ] **Step 3: Build and hand off POS**

```bash
cd "C:\Users\ianla\webapps\POS"
npx tsc --noEmit
npm run build
```
POS pushes are the user's own action, not this plan's — commit locally and stop.

- [ ] **Step 4: Live smoke test**

1. In Store Management → Online Orders (as admin/manager), open "Delivery & Pricing" for a store, set delivery fee, minimum order, and a baseline prep time (e.g. 15), save.
2. **Immediately confirm delivery is still on.** Reload the Online Orders page and check the delivery pause switch still reads "on" for that store, and that `stores/{storeId}/storefrontConfig/main.deliveryEnabled` is `true` (not `false`, and not missing) in the Firestore console. This is the regression the `!== false` read in Task 5 exists to prevent — verify it rather than assume it.
3. On the website, add items to cart and reach checkout for that store — confirm the fee/min-order/prep-time note all show correctly.
4. In the POS Kitchen page, create a couple of active (`preparing`) tickets for that store (place a real online order, or start a dine-in session with items).
5. Refresh the website checkout page — confirm the "Ready in about N min" line increases by roughly 1 minute per active ticket, capped at baseline+20.
6. Mark those tickets served/ready and refresh again — confirm the ETA drops back toward baseline.
7. **If the ETA sits pinned at baseline+20 with an idle kitchen**, the cause is almost certainly stale `preparing` tickets — the count has no time bound, so a ticket abandoned in `preparing` months ago still counts forever. Check with a console query on the `kitchentickets` collection group filtered to that `storeId` + `status == "preparing"` and confirm the count matches what the KDS actually shows before blaming the formula.

---

## Self-Review

**Spec coverage:** "configurable delivery charge" → Task 5/6 (deliveryFee field). "minorder" → Task 5/6 (minOrder field). "preptime based on active kitchen ticket number" → Task 2 (the actual load formula) + Task 3 (displaying it) + Task 5/6 (the baseline manager sets). "and other" — left open in the design as tunable constants (`PREP_TIME_MINUTES_PER_ACTIVE_TICKET`, `PREP_TIME_MAX_BONUS_MINUTES`) and a documented v1 scope decision (storewide ticket count, not per-kitchen-station) rather than guessing at unstated additional factors.

**Placeholder scan:** no TBD/TODO/"add validation" left in any step; every code block is complete, working code against real, verified APIs (firebase-admin `.count()` — `functions/package.json` pins `firebase-admin ^12.6.0`, which has it; the existing route's op contract; the existing stub's doc-path convention, which `_allOfCollectionGroup`'s `segs[len-2]` test matches exactly).

**Type consistency:** `DeliveryConfig`/`DeliveryConfigInput` (Task 4) match the fields consumed in `FullConfig` (Task 5). `dynamicPrepEtaMinutes`/`computePrepEtaMinutes` signatures (Task 2) match their call site in `getStorefrontCatalog`. `sanitizeDeliveryConfig` is imported with the exact name/path Task 5 uses.

**Known scope decisions, not gaps:**
- Ticket-count load is storewide, not per kitchen station — matches "active kitchen ticket number" literally; per-station granularity would need `kitchenLocationId` threading through the checkout flow, out of scope.
- Only `status == "preparing"` counts, even though the POS KDS's own active bucket is `preparing || partially_served` (`src/app/kitchen/page.tsx:924`, `src/components/kitchen/kds-item-card.tsx:93`). A partially-served ticket is already half-cooked, so counting it at full weight would overstate load; keeping a single equality filter also keeps the query on a two-field equality index and the test stub on `==`-only. Widening to `where("status","in",["preparing","partially_served"])` later needs an `in` operator in the stub, nothing else.
- The count has no time bound, so a ticket abandoned in `preparing` counts forever. Accepted for v1 (it is also a useful signal that the KDS has stale rows); the diagnostic is Task 7 Step 4.7. Bounding it by `createdAt` would turn the query into equality+range and require a three-field `COLLECTION_GROUP` index.
- The ETA is computed once, when the checkout page loads its config — it does not tick or re-poll while the customer fills in the form. Acceptable for an estimate; the number is recomputed on every page load.
- No server-side enforcement ties the displayed ETA to anything at order-placement time — it's a customer-facing estimate, not a promise the backend holds itself to. Consistent with how `deliveryFee`/`minOrder` are already just recomputed server-side at `placeOrder` time from the same config doc, independent of what the customer saw at checkout load time.
- `sanitizeDeliveryConfig` rounds fees to whole pesos, which is stricter than the server's own clamping — no ₱49.50 delivery fee is expressible through this dialog. Deliberate (see the function's doc comment); revisit only if a branch actually needs sub-peso pricing.

**Pre-execution review corrections (2026-08-12), verified against both repos:**
- Task 7 Step 1 previously claimed no new Firestore index was needed. That was wrong: the cited index is `COLLECTION`-scoped and cannot serve a `collectionGroup()` query. Step 1 now adds a `COLLECTION_GROUP` index and flags that `firestore.indexes.json` is already out of sync with the live project.
- Task 2 now wraps the count query so an index/permissions failure degrades to the baseline instead of 500-ing `getStorefrontCatalog` — which serves the entire online menu. A fifth test covers this using the stub's existing `forbid` hook.
- Task 5 read `deliveryEnabled` with `!!c.deliveryEnabled`, the opt-in reading. Every reader of that doc uses the opt-out `!== false`, and almost no store has the field set, so opening and saving the dialog would have silently disabled delivery — the exact bug fixed this morning. Now `!== false`, with `EMPTY.deliveryEnabled` flipped to `true` to match, a `loadError` state that blocks saving on top of a failed load, and an explicit form reset on each open.
- Smaller corrections: Task 6 added a second `from "lucide-react"` import alongside the existing one (now merged into line 21's import); Task 4's doc comment claimed the sanitizer "mirrors" the server's clamping when it is actually stricter (it rounds, the server doesn't); Task 5's Interfaces block pointed at `StoreEditDialog` as the prop-shape precedent, but that component uses `isOpen`/`onSave` and leaves persistence to its parent — replaced with `CashierTipModal`, which is the actual match; Task 1's `count().get()` used `Promise.resolve()` where the rest of the stub uses the module's `tick()`; and every "insert here" anchor in Tasks 2, 3 and 6 now cites the real current line number.
- Tasks 1-2 were executed verbatim against copies of the real `functions/index.js` and `tests/helpers/*.cjs`: 7/7 pass (including the new degradation test), and the 71-pre-existing-test baseline was confirmed by running the existing suite. Every other file/line/symbol the plan cites was opened and confirmed: `route.ts`'s op switch and per-op `isManagerOrAbove` gates, `types.ts:492` `OrderItemStatus` + `:503` `KitchenTicket.storeId`, both kitchenticket write paths (`sessions/*` and `onlineOrders/*`, the latter at `online-order-tickets.ts:92` writing `status: "preparing"` + `storeId`), `firestore.rules:298-307` (storefrontConfig excluded from client writes, readable), `shop-checkout.ts:11-19/571-587`, `checkout.astro:38`, `OnlineOrdersClient.tsx`'s imports/state/JSX structure, and `mkReq`'s `...extra` spread that lets `{ query: { storeId } }` override the default empty `query`.
