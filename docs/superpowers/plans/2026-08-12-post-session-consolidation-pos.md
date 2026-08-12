# Consolidation, Deploy & Push Plan — POS repo, 2026-08-12

**Repo:** `C:\Users\ianla\webapps\POS`
**Firebase project (POS/hub):** `shareat-hub-v2`
**Related repo (read-only in this plan):** `C:\Users\ianla\webapps\Shareat Website` (project `shareat-website`)

---

## 0. Verified current state (facts, not reports)

All of the following was confirmed by running the commands, not by trusting the session summaries.

| Item | Verified state |
|---|---|
| Checkout | `C:\Users\ianla\webapps\POS` on `sev6`, **working tree clean** |
| `sev6` vs `origin/sev6` | **ahead 15, behind 0**. Tip `4b6a761` (merge of `item-photo-local-global`), plus `d918287` (delivery-pricing plan doc) on the mainline and 13 item-photo commits `d82ad7a..084b2f2` on the merged side branch |
| `origin/sev6` tip | `4010f23` — already contains `6a392f3` (security audit). Session 3's "already pushed" claim is **true** |
| `sev5_advanced` | `6454bff`, **in sync with `origin/sev5_advanced`** (ahead 0, behind 0) |
| `sev5_advanced` topology | Branched from `sev6` at `6a392f3`; the 3 later commits (`42aa1b7`, `ec85c52`, `6454bff`) are **cherry-picks**, confirmed from `git reflog show sev5_advanced` (`cherry-pick: …` entries). **Cherry-pick is the established porting mechanism** — not merge |
| `feature/delivery-pricing-dynamic-prep` | Branch and worktree at `C:\Users\ianla\webapps\POS\.worktrees\delivery-pricing-dynamic-prep` **both intact, working tree clean**, tip `1655233`, 5 commits ahead of merge-base `4010f23` |
| Merge conflict risk (feature → sev6) | **Zero.** `git merge-tree --write-tree --messages sev6 feature/delivery-pricing-dynamic-prep` returns a tree hash with no conflict messages |
| Feature branch contents | Only 5 files: `firestore.indexes.json`, `DeliveryPricingSettings.tsx` (new), `OnlineOrdersClient.tsx` (+14/−1), `src/lib/storefront/delivery-config.ts` (new), `delivery-config.test.ts` (new, 5 tests) |
| `firebase` CLI | v15.15.0, logged in as `ianlalusin@gmail.com`, `--dry-run` supported |
| Dev-server / port state | 6 `node.exe` processes alive (Claude/MCP, started 17:18–20:30), **no listener on 9002/3000/8080/9099/5000/4000**. No ghost listener. No dev server currently running |
| Local Node | v24.14.1, while `package.json` pins `engines.node >=20 <21`; `nvm` not on PATH. Builds have worked today anyway (Next 16 supports Node 24) |

### Five corrections to the session reports

1. **The `kitchentickets` COLLECTION_GROUP index ALREADY EXISTS in production.** `firebase firestore:indexes --project shareat-hub-v2` shows a live `kitchentickets` / `COLLECTION_GROUP` / `(status ASC, storeId ASC, __name__ ASC)` index. The query it must serve (`.where("storeId","==",…).where("status","==","preparing").count()`) is equality-only on exactly those two fields, and equality-field order in a composite index is not significant to the planner. **No index deploy is needed.**

2. **`firebase deploy --only firestore:indexes` is actively dangerous here and must NOT be run.** The repo's `firestore.indexes.json` declares **13 indexes and `"fieldOverrides": []`**. Production has **~57 indexes and 2 fieldOverrides** (`kdsTickets.createdAt`, `kitchentickets.storeId`). A deploy would prompt to delete roughly 44 live indexes plus both field overrides — including every `COLLECTION_GROUP` `kitchentickets` index that `SyncKdsTicketsTool.tsx`, `backfillServer.ts` and `scripts/settle-payment-mix-drift.ts` depend on. The plan doc itself flagged the drift; the actual magnitude is worse than it implied. Decision #2's "deploy the index" resolves to **verify-and-skip**.

3. **The "dynamic prep-time" feature is not in this repo at all.** POS's feature branch ships only the *baseline* `prepEtaMinutes` config field. The live ticket-count query lives in `C:\Users\ianla\webapps\Shareat Website\functions\index.js:136` (`countActiveKitchenTickets`), merged there as `ba31a78` on branch `online-order` and pushed to `origin/online-order`. POS owns the index file; the website owns the consumer. That split drives the smoke-test preconditions in Phase 8.

4. **Session 1's claim that `storefront-catalog/route.ts` "already has tests" is false.** `src/app/api/admin/storefront-catalog/` contains `route.ts` and nothing else. The landmine fix therefore needs a new test file — a well-established harness pattern exists at `src/app/api/admin/online-orders/route.test.ts` to copy.

5. **The landmine is currently unreachable, which makes the fix zero-risk.** On `sev6` today there is *no* caller of `op: "set-config"` anywhere in the repo. After the merge the only caller is `DeliveryPricingSettings.tsx`, which always sends explicit `pickupEnabled`/`deliveryEnabled` booleans read with `!== false`. The fix is purely defensive.

### Ordering rationale (non-obvious calls)

- **Rules deploy goes first (Phase 2), before the merge.** The rules files are untouched by the feature branch (`git diff --stat sev6...feature` = 5 files, none of them `*.rules`), so the merge cannot change what gets deployed. Production is currently running *without* the security-audit fixes — that is the highest-severity open item, and decoupling it from merge work means a merge problem cannot delay it.
- **`npm run test:rules` runs before the rules deploy, not after.** Never ship a ruleset that hasn't passed its own suite.
- **Merge before the landmine fix.** Both touch disjoint files, but doing the merge first means the full verification sweep (Phase 6) runs once, on the final tree.
- **Index: verify, do not deploy.** See correction #2.
- **`sev5_advanced` port happens after `sev6` is fully green**, so a verified tree is what gets ported and pushed.
- **`sev6` is never pushed.** Phase 7 ends in a handoff, per repo policy.

---

## Phase 1 — Pre-flight verification (~5 min, read-only)

Re-confirm state at execution time; another session or Ian may have moved things since this plan was written.

```powershell
git -C "C:\Users\ianla\webapps\POS" fetch origin
git -C "C:\Users\ianla\webapps\POS" status
git -C "C:\Users\ianla\webapps\POS" branch -vv
git -C "C:\Users\ianla\webapps\POS" worktree list
git -C "C:\Users\ianla\webapps\POS" log --oneline --graph origin/sev6..sev6
git -C "C:\Users\ianla\webapps\POS" log --oneline sev6..feature/delivery-pricing-dynamic-prep
git -C "C:\Users\ianla\webapps\POS" merge-tree --write-tree --messages sev6 feature/delivery-pricing-dynamic-prep
```

**Abort and re-plan if any of these is not true:**
- `git status` is not `On branch sev6` + `nothing to commit, working tree clean`
- `sev6` is `behind` `origin/sev6` by anything (Ian pushed directly again — see the `apphosting.yaml` incident in Session 1's report; a rebase/merge decision is his, not yours)
- `sev5_advanced` is not `ahead 0, behind 0` vs `origin/sev5_advanced`
- `merge-tree` prints `CONFLICT` lines instead of a bare tree hash
- The `.worktrees\delivery-pricing-dynamic-prep` worktree is missing or dirty

Process/port fallout from Session 3's `taskkill /F /IM node.exe`:

```powershell
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,StartTime
netstat -ano | Select-String -Pattern ':9002|:3000|:8080'
```

Expected: node processes present (agent/MCP infrastructure), **no listener on 9002**. If a listener on 9002 exists but no dev server is running, that is the known `reference_dev_port_9002_ghost_listener` landmine — kill only that PID:

```powershell
netstat -ano | Select-String ':9002'
taskkill /F /PID <the PID from the LISTENING line>
```

Nothing else needs restarting: the killed processes were dev servers and emulators, neither of which is running or required until Phase 8.

---

## Phase 2 — Deploy Firestore + Storage rules to production (Decision #1)

This covers **both** the security audit (`6a392f3`, already on `origin/sev6`) and the item-photo feature (`d82ad7a`, `c6dc0c9`, local only) — they modify the same two files, and the working tree on `sev6` already holds the union.

### 2.1 Confirm what is about to be deployed

```powershell
git -C "C:\Users\ianla\webapps\POS" diff --stat 0688cc3..sev6 -- firestore.rules storage.rules
git -C "C:\Users\ianla\webapps\POS" diff 0688cc3..sev6 -- firestore.rules storage.rules
```

Expected content (already verified):
- `firestore.rules`: `stores/{storeId}` write/delete gated to `isManagerOrAdmin()`; `'storeConfig'` added to `isConfigCollection()` with the `storeConfig/current/tables/{t}` cashier carve-out; new `productPhotoRequests/{requestId}` block (`read, list: if isActiveStaff()`, all writes `false`)
- `storage.rules`: `loyaltyRewardImages` writes narrowed to admin-only; new `productPhotos/{productId}/{storeId}/{fileName}` block

### 2.2 Check the live rules have not drifted

`firebase` has no rules-download command, so this is a console check — **do it, do not skip it.** Another session or a console edit could have changed production since these files were written.

- https://console.firebase.google.com/project/shareat-hub-v2/firestore/rules → **Rules tab → History**. Confirm the newest published version predates today's work and that its text matches `git show 0688cc3:firestore.rules`.
- https://console.firebase.google.com/project/shareat-hub-v2/storage/rules → same check against `git show 0688cc3:storage.rules`.

If the live ruleset does **not** match `0688cc3`, stop and escalate to Ian — someone edited rules in the console and deploying would silently revert them.

### 2.3 Run the rules test suite

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run test:rules
```

This runs `firebase emulators:exec --only firestore --project demo-pos "vitest run --config vitest.rules.config.ts"`, so **the Firestore emulator needs a JRE on PATH**. If it fails with a Java error, that is an environment problem, not a rules problem — install/point to a JRE and re-run; do not deploy unverified rules.

Expected: **204 passing, 0 failing** (Session 3's reported baseline). Any failure blocks the deploy.

### 2.4 Dry run, then deploy

```powershell
cd "C:\Users\ianla\webapps\POS"
firebase deploy --only firestore:rules,storage:rules --project shareat-hub-v2 --dry-run
```

Read the output. It must mention **only** `firestore: rules file firestore.rules compiled successfully` and `storage: rules file storage.rules compiled successfully`. If it mentions **indexes, functions, or hosting**, stop — the `--only` filter is not doing what it should.

```powershell
cd "C:\Users\ianla\webapps\POS"
firebase deploy --only firestore:rules,storage:rules --project shareat-hub-v2 -m "sev6: admin/manager security audit (6a392f3) + item-photo productPhotoRequests/productPhotos rules"
```

### 2.5 Post-deploy behaviour changes to expect (tell Ian)

These are intended, but they are user-visible and take effect **immediately**, before the app code that pairs with them is deployed:

- **Non-manager staff can no longer write `stores/{storeId}`.** Any cashier/server/kitchen client still writing that doc directly will now get `permission-denied`.
- **`stores/{id}/storeConfig/current` now requires manager/admin.** `rebuildStoreConfig()` in `src/lib/manager/dataManagement.ts` is manager-gated already; the cashier-path carve-out is `storeConfig/current/tables/{t}` only. If a cashier flow writes anywhere else under `storeConfig`, it will start failing.
- **`loyaltyRewardImages` uploads are now admin-only.** A manager uploading a reward image in the currently-deployed build will get a Storage permission error.

Watch the POS error logs / a live till for ~15 minutes after this deploy. Roll back from the console Rules **History** tab if a cashier-path write starts failing.

---

## Phase 3 — Merge `feature/delivery-pricing-dynamic-prep` into `sev6` (Decision #2, part 1)

```powershell
git -C "C:\Users\ianla\webapps\POS" checkout sev6
git -C "C:\Users\ianla\webapps\POS" merge --no-ff feature/delivery-pricing-dynamic-prep -m "Merge branch 'feature/delivery-pricing-dynamic-prep' into sev6"
```

`--no-ff` matches how `item-photo-local-global` was integrated (`4b6a761` is a real merge commit), keeping the 5 feature commits identifiable on a side branch.

Verify:

```powershell
git -C "C:\Users\ianla\webapps\POS" status
git -C "C:\Users\ianla\webapps\POS" log --oneline --graph -8
git -C "C:\Users\ianla\webapps\POS" diff --stat HEAD^ HEAD
```

Expected `diff --stat`: exactly the 5 files listed in §0 — `firestore.indexes.json`, `src/components/admin/online-orders/DeliveryPricingSettings.tsx`, `src/components/admin/online-orders/OnlineOrdersClient.tsx`, `src/lib/storefront/delivery-config.ts`, `src/lib/storefront/delivery-config.test.ts`.

Sanity-check the one file both work streams touched (`OnlineOrdersClient.tsx` — modified by the merged radius/cashier-toggle work *and* by the pricing-dialog wiring):

```powershell
git -C "C:\Users\ianla\webapps\POS" diff HEAD^ HEAD -- src/components/admin/online-orders/OnlineOrdersClient.tsx
```

Expected: the `Settings2` lucide import added to the existing line-21 import, the `DeliveryPricingSettings` import, `isManagerOrAbove`, `pricingOpen` state, the header Button, and the dialog mount before `</RoleGuard>`. Nothing removed. Both `DeliveryAvailabilityControl` and `OnlineAvailabilityControl` must still be present.

Then remove the now-merged worktree (it is finished; leaving it invites a future session editing a stale copy):

```powershell
git -C "C:\Users\ianla\webapps\POS" worktree remove "C:\Users\ianla\webapps\POS\.worktrees\delivery-pricing-dynamic-prep"
git -C "C:\Users\ianla\webapps\POS" worktree list
```

Keep the **branch** `feature/delivery-pricing-dynamic-prep` — do not delete it. It is unpushed, and it is the only handle if the `sev5_advanced` question in Open Questions #1 comes back "yes".

---

## Phase 4 — Fix the `set-config` `deliveryEnabled` landmine (TDD)

Confirmed genuinely isolated: one line, one file, currently zero callers, and after the merge the only caller sends an explicit boolean. Session 1's claim that tests already exist for this file is wrong, so the test comes with it.

### 4.1 Write the failing test (RED)

**Create:** `C:\Users\ianla\webapps\POS\src\app\api\admin\storefront-catalog\route.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for the storefront-catalog admin op endpoint.
 *
 * Focus: the boolean semantics of `set-config`. `stores/{id}/storefrontConfig/main`
 * is read as opt-OUT everywhere it is consumed — `cfg.deliveryEnabled !== false`
 * in Shareat Website functions/index.js:1541, in DeliveryPricingSettings.tsx and
 * in OnlineOrdersClient.tsx — so an ABSENT field means ENABLED. `set-config`
 * rebuilds the whole config document from the request body rather than patching
 * it, so it must default an omitted boolean the same way; `!!` here was the
 * opt-IN reading, and any future caller that omitted the field would have
 * silently paused delivery for the branch. Same bug class as the original
 * delivery-picker bug.
 *
 * Harness mirrors src/app/api/admin/online-orders/route.test.ts: an in-memory
 * Firestore double, FieldValue mocked to a recognisable sentinel, so assertions
 * read the write payload directly.
 */

const ACTOR_UID = "staff_uid_1";
const STORE = "L5MExycvUOfQ96Y10FqF"; // SharEat Lipa (NEXT_PUBLIC_STOREFRONT_STORE_ID)
const CONFIG_PATH = `stores/${STORE}/storefrontConfig/main`;

// --- module mocks ----------------------------------------------------------

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: async () => ({ uid: ACTOR_UID }) }),
  getAdminDb: () => harness.db,
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async () => ({
    isPlatformAdmin: false,
    assignedStoreIds: [STORE],
    role: mockStaffRole,
  }),
}));

vi.mock("@/lib/server/storefront-catalog", () => ({
  rebuildStorefrontCatalog: vi.fn(async () => ({ itemCount: 0 })),
}));

import { POST } from "./route";

// --- in-memory firestore double --------------------------------------------

type SetOp = { path: string; data: any; options: any };

function makeHarness(docs: Record<string, any>) {
  const sets: SetOp[] = [];
  const db = {
    doc: (path: string) => ({
      path,
      get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
      set: async (data: any, options?: any) => {
        sets.push({ path, data, options });
        docs[path] = { ...(docs[path] ?? {}), ...data };
      },
    }),
  };
  return { db, docs, sets };
}

let harness: ReturnType<typeof makeHarness>;
let mockStaffRole: string;

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/admin/storefront-catalog", {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function configWrite(): any {
  const found = harness.sets.filter((s) => s.path === CONFIG_PATH);
  return found.length ? found[found.length - 1].data : null;
}

beforeEach(() => {
  mockStaffRole = "manager";
  harness = makeHarness({ [`stores/${STORE}`]: { name: "SharEat Lipa" } });
});

describe("set-config boolean semantics", () => {
  it("writes deliveryEnabled: true when the caller sends true", async () => {
    const res = await post({
      op: "set-config",
      storeId: STORE,
      config: { pickupEnabled: true, deliveryEnabled: true, deliveryFee: 50 },
    });
    expect(res.status).toBe(200);
    expect(configWrite().deliveryEnabled).toBe(true);
  });

  it("writes deliveryEnabled: false when the caller explicitly sends false", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { pickupEnabled: true, deliveryEnabled: false },
    });
    expect(configWrite().deliveryEnabled).toBe(false);
  });

  // The regression this file exists for. Fails against `!!c.deliveryEnabled`.
  it("defaults an OMITTED deliveryEnabled to true (opt-out, matching every reader)", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryFee: 50, minOrder: 200 },
    });
    expect(configWrite().deliveryEnabled).toBe(true);
  });

  it("defaults an omitted pickupEnabled to true too (unchanged sibling, pins the convention)", async () => {
    await post({ op: "set-config", storeId: STORE, config: { deliveryFee: 50 } });
    expect(configWrite().pickupEnabled).toBe(true);
  });

  it("still clamps the numeric fields and caps serviceAreaNote", async () => {
    await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryFee: -5, minOrder: "200", prepEtaMinutes: 15, serviceAreaNote: "x".repeat(400) },
    });
    const w = configWrite();
    expect(w.deliveryFee).toBe(0);
    expect(w.minOrder).toBe(200);
    expect(w.prepEtaMinutes).toBe(15);
    expect(w.serviceAreaNote).toHaveLength(300);
    expect(w.currency).toBe("PHP");
  });

  it("rejects a cashier (pricing config stays manager-and-up)", async () => {
    mockStaffRole = "cashier";
    const res = await post({
      op: "set-config",
      storeId: STORE,
      config: { deliveryEnabled: true },
    });
    expect(res.status).toBe(403);
  });
});

describe("set-delivery-enabled (deliberately NOT changed by this fix)", () => {
  it("writes exactly the boolean it is given, and merges only that one field", async () => {
    mockStaffRole = "cashier";
    const res = await post({ op: "set-delivery-enabled", storeId: STORE, deliveryEnabled: false });
    expect(res.status).toBe(200);
    const w = configWrite();
    expect(w.deliveryEnabled).toBe(false);
    expect(Object.keys(w).sort()).toEqual(["deliveryEnabled", "updatedAt"]);
  });
});
```

Run it and confirm exactly one failure, for the right reason:

```powershell
cd "C:\Users\ianla\webapps\POS"
npx vitest run src/app/api/admin/storefront-catalog/route.test.ts
```

Expected RED: `defaults an OMITTED deliveryEnabled to true` fails with `expected false to be true`. All six others pass.

### 4.2 Apply the fix (GREEN)

**Modify:** `C:\Users\ianla\webapps\POS\src\app\api\admin\storefront-catalog\route.ts` (line 73)

```diff
@@ -70,7 +70,15 @@
         const c = body?.config ?? {};
         const config: Record<string, any> = {
           pickupEnabled: c.pickupEnabled !== false,
-          deliveryEnabled: !!c.deliveryEnabled,
+          // Opt-OUT, exactly like pickupEnabled above and like every READER of
+          // this doc: Shareat Website functions/index.js:1541,
+          // DeliveryPricingSettings.tsx and OnlineOrdersClient.tsx all use
+          // `!== false`, so an ABSENT field means ENABLED. This was `!!`, the
+          // opt-IN reading — because set-config rebuilds the whole document
+          // rather than patching it, any caller that omitted the field would
+          // have silently paused delivery for the branch. `set-delivery-enabled`
+          // below deliberately keeps `!!`: that op IS the explicit on/off
+          // switch, and its caller always sends a concrete boolean.
+          deliveryEnabled: c.deliveryEnabled !== false,
           deliveryFee: Math.max(0, Number(c.deliveryFee ?? 0)) || 0,
           minOrder: Math.max(0, Number(c.minOrder ?? 0)) || 0,
           prepEtaMinutes: Math.max(0, Number(c.prepEtaMinutes ?? 0)) || 0,
```

Line 117 (`set-delivery-enabled`) is **intentionally left as `!!body?.deliveryEnabled`** — that op's entire purpose is an explicit toggle and its caller (`OnlineOrdersClient.tsx:432`) always sends `deliveryEnabled: next`. The scope of this fix is one line.

```powershell
cd "C:\Users\ianla\webapps\POS"
npx vitest run src/app/api/admin/storefront-catalog/route.test.ts
```

Expected GREEN: 7 passed.

### 4.3 Commit

```powershell
cd "C:\Users\ianla\webapps\POS"
git add src/app/api/admin/storefront-catalog/route.ts src/app/api/admin/storefront-catalog/route.test.ts
git commit -m "Make set-config write deliveryEnabled with opt-out semantics

storefrontConfig/main.deliveryEnabled is read as \`!== false\` everywhere it
is consumed (Shareat Website functions/index.js:1541,
DeliveryPricingSettings.tsx, OnlineOrdersClient.tsx), so an absent field
means ENABLED. set-config wrote it as \`!!c.deliveryEnabled\`, the opt-IN
reading, and because that op rebuilds the whole config document instead of
patching it, any caller omitting the field would have silently paused
delivery for the branch — the same bug class as the original
delivery-picker bug.

Not currently triggerable: the only caller (the Delivery & Pricing dialog)
always sends a concrete boolean. Fixed as a landmine, with the route's
first test file to pin the semantics. set-delivery-enabled keeps \`!!\` on
purpose: that op is the explicit on/off switch."
```

---

## Phase 5 — Fix the stale Storage path in the two item-photo docs

Shipped reality (verified): `src/lib/firebase/client.ts:63` writes `` `productPhotos/${productId}/${storeId}/${crypto.randomUUID()}.webp` `` and `storage.rules:98` matches `productPhotos/{productId}/{storeId}/{fileName}`. Both docs still describe the abandoned deterministic `…/{storeId}.webp` path. Seven lines across two files.

### 5.1 `docs\superpowers\specs\2026-08-12-item-photo-local-global-design.md`

**Line 64:**
```diff
-New path: `productPhotos/{productId}/{storeId}.webp`.
+New path: `productPhotos/{productId}/{storeId}/{fileName}`, where `{fileName}` is a per-upload `crypto.randomUUID()` + `.webp` (see `uploadItemPhotoLocal` in `src/lib/firebase/client.ts`).
+
+> **Shipped deviation (recorded 2026-08-12):** this section originally specified a deterministic `productPhotos/{productId}/{storeId}.webp`. That was changed during the final fix wave: once an admin promotes a store's photo, `products/{id}.imageUrl` points at that exact object, so a manager re-uploading over a deterministic name would have hijacked (and on delete, broken) the global image for every store. A unique filename per upload makes replacement land on a new object.
```

**Line 68** (inside the storage.rules code block):
```diff
-match /productPhotos/{productId}/{storeId}.webp {
+match /productPhotos/{productId}/{storeId}/{fileName} {
```

**Line 84** (the `submit` row of the ops table):
```diff
-| `submit` | `requireStaffStoreAccess(db, decoded, storeId, ["admin","manager"])` | Client has already uploaded to `productPhotos/{productId}/{storeId}.webp`. Route does, in one write:
+| `submit` | `requireStaffStoreAccess(db, decoded, storeId, ["admin","manager"])` | Client has already uploaded to `productPhotos/{productId}/{storeId}/{uuid}.webp`. Route does, in one write:
```
(rest of that table row unchanged)

### 5.2 `docs\superpowers\plans\2026-08-12-item-photo-local-global.md`

**Line 118:**
```diff
-- Produces: `productPhotos/{productId}/{storeId}.webp` writable by `isStoreManagerOrAdmin(uid, storeId)`, public read (via the existing root `{allPaths=**} { allow read; }` rule — no change needed there).
+- Produces: `productPhotos/{productId}/{storeId}/{fileName}` writable by `isStoreManagerOrAdmin(uid, storeId)`, public read (via the existing root `{allPaths=**} { allow read; }` rule — no change needed there).
+
+> **Shipped deviation (recorded 2026-08-12):** Tasks 2 and 12 below were written against a deterministic `…/{storeId}.webp` object name. The code that shipped uses a per-upload `crypto.randomUUID()` filename (`storage.rules:98`, `src/lib/firebase/client.ts:63`) so that replacing a local photo after promotion cannot overwrite the object every store's global `products/{id}.imageUrl` points at. The snippets below have been corrected to match what shipped.
```

**Line 130** (inside the storage.rules snippet):
```diff
-    match /productPhotos/{productId}/{storeId}.webp {
+    match /productPhotos/{productId}/{storeId}/{fileName} {
```

**Line 685** (inside the `uploadItemPhotoLocal` doc comment):
```diff
- * productPhotos/{productId}/{storeId}.webp. Does NOT write any Firestore
+ * productPhotos/{productId}/{storeId}/{uuid}.webp. Does NOT write any Firestore
```

**Line 695:**
```diff
-    const storageRef = ref(storage, `productPhotos/${productId}/${storeId}.webp`);
+    const storageRef = ref(storage, `productPhotos/${productId}/${storeId}/${crypto.randomUUID()}.webp`);
```

### 5.3 Verify no stale references remain, and commit

```powershell
cd "C:\Users\ianla\webapps\POS"
Select-String -Path "docs\superpowers\specs\2026-08-12-item-photo-local-global-design.md","docs\superpowers\plans\2026-08-12-item-photo-local-global.md" -Pattern 'productPhotos/\{productId\}/\{storeId\}\.webp|\$\{storeId\}\.webp'
```

Expected: **no matches**.

```powershell
cd "C:\Users\ianla\webapps\POS"
git add docs/superpowers/specs/2026-08-12-item-photo-local-global-design.md docs/superpowers/plans/2026-08-12-item-photo-local-global.md
git commit -m "Correct the item-photo docs to the Storage path that actually shipped

Both the design spec and the plan still described the deterministic
productPhotos/{productId}/{storeId}.webp object name. The final fix wave
replaced it with a per-upload crypto.randomUUID() filename
(storage.rules:98, src/lib/firebase/client.ts:63) so that replacing a
local photo after promotion cannot hijack the object every store's global
products/{id}.imageUrl points at. Docs were never updated; they are now,
with a short note at each site recording why the path changed."
```

---

## Phase 6 — Firestore index: verify, then deliberately do NOT deploy (Decision #2, part 2)

### 6.1 Confirm the index already exists in production

```powershell
cd "C:\Users\ianla\webapps\POS"
firebase firestore:indexes --project shareat-hub-v2 > "$env:TEMP\live-indexes.json"
Select-String -Path "$env:TEMP\live-indexes.json" -Pattern 'COLLECTION_GROUP' -Context 0,12
```

Confirm the presence of a `kitchentickets` / `COLLECTION_GROUP` index whose fields are `storeId` and `status` (in either order; production currently has them as `status, storeId, __name__`). This serves the equality-only query in `Shareat Website\functions\index.js:136-144`. It was almost certainly created via a console error link by the existing `SyncKdsTicketsTool.tsx` collection-group query (`src/components/kitchen/SyncKdsTicketsTool.tsx:32-37`), exactly as Session 1 suspected.

### 6.2 Do NOT run `firebase deploy --only firestore:indexes`

Count the drift before deciding anything else:

```powershell
$live = (Get-Content "$env:TEMP\live-indexes.json" -Raw | ConvertFrom-Json)
"live indexes: {0}" -f $live.indexes.Count
"live fieldOverrides: {0}" -f $live.fieldOverrides.Count
$repo = (Get-Content "C:\Users\ianla\webapps\POS\firestore.indexes.json" -Raw | ConvertFrom-Json)
"repo indexes: {0}" -f $repo.indexes.Count
"repo fieldOverrides: {0}" -f $repo.fieldOverrides.Count
```

Expected roughly: live 57 / 2, repo 13 / 0. **An index deploy would offer to delete ~44 production indexes and both field overrides**, including every `COLLECTION_GROUP` `kitchentickets` index that `SyncKdsTicketsTool.tsx`, `src/lib/server/analytics/backfillServer.ts:51` and `scripts/settle-payment-mix-drift.ts:139` rely on. The index the feature branch wanted is already live, so there is **nothing to gain and a production outage to lose**.

`firestore.indexes.json` keeps the new entry as documentation of what the query needs — the file is already known-stale and this makes it marginally less so. Leave it committed.

### 6.3 Verify the query actually resolves (cheap, decisive)

After the website is confirmed deployed (Phase 8.1), check the Cloud Function logs for the degradation path:

```powershell
firebase functions:log --only getStorefrontCatalog --project shareat-website 2>&1 | Select-String "countActiveKitchenTickets"
```

The function's catch block logs the literal string `countActiveKitchenTickets: ticket count failed, falling back to baseline:` (`functions/index.js:146`). **Zero occurrences after a checkout page load = the index is serving the query.** If it appears with a `FAILED_PRECONDITION`, the console error link in that log entry is the correct, surgical way to add the missing index — never a bulk `firestore:indexes` deploy.

Reconciling `firestore.indexes.json` with production is real work (pull all 57 live indexes + 2 field overrides into the file, review each, then deploy) and is **out of scope here** — flagged in Open Questions #4.

---

## Phase 7 — Full verification sweep on `sev6`

Run in this order; each gates the next.

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run typecheck
```
Expected: clean, no output.

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run test
```
Expected: **0 failures.** Session 3's baseline on merged `sev6` was 566 passing. This tree adds `delivery-config.test.ts` (5 tests) from Phase 3 and `storefront-catalog/route.test.ts` (7 tests) from Phase 4 → **578 expected**. Confirm the count went *up* by exactly 12 and nothing regressed; `src/components/admin/online-orders/OnlineOrdersClient.test.ts` is the one to watch, since that component was touched by two independent work streams.

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run test:rules
```
Expected: 204 passing (unchanged — the merge touched no rules). If Phase 2.3 already ran this and nothing under `firestore.rules` / `tests/rules/` changed since, it may be skipped.

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run build
```
Expected: clean Next 16 production build. If it fails on a Node-version error, note that local Node is **v24.14.1** while `package.json` pins `engines.node >=20 <21` (App Hosting builds on Node 20); earlier sessions built successfully today on this same machine, so a sudden Node error means something else changed.

```powershell
git -C "C:\Users\ianla\webapps\POS" status
git -C "C:\Users\ianla\webapps\POS" log --oneline --graph origin/sev6..sev6
```
Expected: clean tree; commits ahead of `origin/sev6` = the pre-existing 15, plus the `--no-ff` merge commit, plus the 5 feature commits it brings, plus the Phase 4 and Phase 5 commits = **22 ahead**. Whatever the number, the top three first-parent entries must be the docs-fix commit, the `set-config` fix commit, and the merge commit.

---

## Phase 8 — Port the item-photo feature to `sev5_advanced` and push (Decision #3)

**Mechanism: cherry-pick**, matching the established pattern proven by `git reflog show sev5_advanced` (three consecutive `cherry-pick:` entries, no merges since the `6a392f3` fast-forward).

**Scope:** the 13 item-photo implementation commits, the 2 item-photo doc commits that were never ported (`10d7721` design spec, `9cd1b87` plan), and the Phase 5 doc-correction commit (it *is* item-photo documentation; porting the feature with knowingly-wrong docs makes no sense). **Explicitly not ported:** `d918287` (delivery-pricing plan doc), the Phase 3 merge, and the Phase 4 `set-config` fix — see Open Questions #1 and #2.

### 8.1 Confirm the port applies cleanly before touching the branch

```powershell
git -C "C:\Users\ianla\webapps\POS" merge-tree --write-tree --messages --merge-base=9cd1b87 sev5_advanced 084b2f2
```
Expected: a bare tree hash plus `Auto-merging src/lib/types.ts`, and **no `CONFLICT` lines**. `src/lib/types.ts` is the only file touched by both `ec85c52` (radius sliders, already on `sev5_advanced`) and the item-photo work — it is the one file to eyeball afterwards. If this prints conflicts, stop and re-plan.

### 8.2 Cherry-pick

```powershell
git -C "C:\Users\ianla\webapps\POS" checkout sev5_advanced
git -C "C:\Users\ianla\webapps\POS" status
```
Confirm clean and `Your branch is up to date with 'origin/sev5_advanced'`.

```powershell
git -C "C:\Users\ianla\webapps\POS" cherry-pick 10d7721 9cd1b87
git -C "C:\Users\ianla\webapps\POS" cherry-pick d82ad7a^..084b2f2
```

`d82ad7a^` resolves to `9cd1b87`, so that range is the 13 commits `d82ad7a` through `084b2f2` inclusive. Then port the Phase 5 doc correction (substitute its real SHA):

```powershell
git -C "C:\Users\ianla\webapps\POS" log --oneline -3 sev6
git -C "C:\Users\ianla\webapps\POS" cherry-pick <SHA of "Correct the item-photo docs to the Storage path that actually shipped">
```

**If any cherry-pick stops on a conflict:** do not improvise a resolution.
```powershell
git -C "C:\Users\ianla\webapps\POS" cherry-pick --abort
git -C "C:\Users\ianla\webapps\POS" status
```
That returns `sev5_advanced` to `6454bff`, untouched. Report the conflicting file and stop.

### 8.3 Verify the ported branch

```powershell
git -C "C:\Users\ianla\webapps\POS" log --oneline -20
git -C "C:\Users\ianla\webapps\POS" diff --stat sev5_advanced sev6
```
The remaining `sev5_advanced ↔ sev6` diff should be only: the delivery-pricing feature files (`DeliveryPricingSettings.tsx`, `delivery-config.ts`, `delivery-config.test.ts`, `OnlineOrdersClient.tsx` wiring, `firestore.indexes.json`), the `set-config` route fix + its test, `docs/…delivery-pricing-and-dynamic-prep-time.md`, and the `apphosting.yaml` variance between `42aa1b7` and `a9be219`/`5125ede`.

Eyeball the one overlapping file:
```powershell
git -C "C:\Users\ianla\webapps\POS" diff sev5_advanced sev6 -- src/lib/types.ts
```
Expected: **empty** (both branches now carry both the radius-slider type additions and the item-photo type additions).

```powershell
cd "C:\Users\ianla\webapps\POS"
npm run typecheck
npm run test
npm run build
```
Expected: clean typecheck, 0 test failures, clean build. `sev5_advanced` lacks the delivery-pricing tests, so the count will be lower than `sev6`'s by 12 — the absolute number matters less than zero failures.

### 8.4 Push (authorized by Decision #3)

```powershell
git -C "C:\Users\ianla\webapps\POS" push origin sev5_advanced
git -C "C:\Users\ianla\webapps\POS" branch -vv
```
Expected: `sev5_advanced` shows `[origin/sev5_advanced]` with no ahead/behind.

### 8.5 Return to `sev6`

```powershell
git -C "C:\Users\ianla\webapps\POS" checkout sev6
git -C "C:\Users\ianla\webapps\POS" status
```

`sev5_advanced` is APK-only, so no rules/index/hosting deploy follows from this push.

---

## Phase 9 — `sev6` handoff (NO PUSH — hard stop)

**`git push origin sev6` is forbidden for agents. Do not run it under any circumstance, including "just to check".** Ian pushes `sev6` himself and sometimes commits to it directly.

Produce this summary for him:

```powershell
git -C "C:\Users\ianla\webapps\POS" fetch origin
git -C "C:\Users\ianla\webapps\POS" log --oneline --graph origin/sev6..sev6
git -C "C:\Users\ianla\webapps\POS" diff --stat origin/sev6..sev6
git -C "C:\Users\ianla\webapps\POS" status
```

Report to Ian:
- `sev6` is clean, N commits ahead of `origin/sev6`, ready for his review and push
- What is in it: 13 item-photo commits + merge (`4b6a761`), the delivery-pricing plan doc (`d918287`), 5 delivery-pricing commits + merge, the `set-config` opt-out fix + its new test, the item-photo doc correction
- Verification: typecheck clean, `npm run test` 578/578, `npm run test:rules` 204/204, `npm run build` clean
- Already done in production: `firestore.rules` + `storage.rules` deployed to `shareat-hub-v2`
- Deliberately not done: no Firestore index deploy (already live; a deploy would delete ~44 production indexes)
- Still to do: the live smoke test (Phase 10), and running `scripts/cleanup-copied-inventory-images.ts`

If `git fetch` shows `sev6` has moved on the remote (Ian pushed while this ran), **do not rebase or merge on his behalf** — report the divergence and stop.

---

## Phase 10 — Live smoke test (for Ian, or a follow-up agent with browser tools)

This is Task 7 Step 4 of `docs\superpowers\plans\2026-08-12-delivery-pricing-and-dynamic-prep-time.md`, never executed. Not runnable in this planning pass (no browser). Exact steps:

### 10.1 Preconditions

1. **The POS side must be deployed.** The pricing dialog lives on `sev6`, which is unpushed. Either wait for Ian's push + App Hosting build, or test locally:
   ```powershell
   cd "C:\Users\ianla\webapps\POS"
   npm run dev
   ```
   → http://localhost:9002 (the repo's dev port; `npm run dev` rimrafs `.next` first). Nothing is listening on 9002 right now, so no ghost-listener cleanup is needed first.

2. **The website side must be deployed with the prep-time code.** `getStorefrontCatalog` is deployed (`v2`, `asia-southeast1`, `nodejs20`), but the version is unverified. The prep-time code landed in `Shareat Website` as `a68941f` (2026-08-12 19:05) and merged at `ba31a78` (20:37), pushed to `origin/online-order`. Compare the function's last-deploy timestamp at
   https://console.firebase.google.com/project/shareat-website/functions
   against 2026-08-12 20:37 +08:00. If it is older, the ETA test (steps 5–7) will fail for the wrong reason — deploy first (Task 7 Step 2 of that plan):
   ```powershell
   cd "C:\Users\ianla\webapps\Shareat Website"
   npm run build
   node --test tests/*.functions.test.cjs tests/firestore-stub-collectiongroup.test.cjs
   firebase deploy --only hosting --project shareat-website
   firebase deploy --only functions:getStorefrontCatalog --project shareat-website
   ```
   (Website deploys are Ian's call; that repo is also 1 commit ahead of `origin/online-order` — `5da69c5`, a docs-only fix.)

3. **Test store:** `L5MExycvUOfQ96Y10FqF` (SharEat Lipa) — the value of `NEXT_PUBLIC_STOREFRONT_STORE_ID` in `apphosting.yaml`, and the store the website's own fallback config defaults to. Public site: https://shareat.net

### 10.2 Steps

1. Sign in to POS as **admin or manager** → **Online Orders** → select SharEat Lipa. A **"Delivery & Pricing"** button (gear icon) appears in the page header next to the delivery-pause switch. Sign in as a **cashier** and confirm the button is **absent** (`isManagerOrAbove` gate) while the open/close and pause-delivery switches remain usable.
2. Open the dialog. Confirm you see a spinner first, never a one-frame flash of zeros or the previous store's values (the load-flash fix in `29ecc62`).
3. Set Delivery fee = `50`, Minimum order = `200`, Baseline prep time = `15`, Service area note = `Lipa proper only`. Save. Expect the toast "Delivery & pricing settings saved".
4. **Regression check — the one that matters.** Reload the Online Orders page. The **delivery pause switch must still read ON**. Then open
   https://console.firebase.google.com/project/shareat-hub-v2/firestore/data/~2Fstores~2FL5MExycvUOfQ96Y10FqF~2FstorefrontConfig~2Fmain
   and confirm `deliveryEnabled` is **`true`** — not `false`, not missing. This is the original delivery-picker bug; verify it, do not assume.
5. **Lost-update race check.** Reopen "Delivery & Pricing" and leave it open. In a second browser (or a cashier device), flip the **pause delivery** switch OFF for the same store. Back in the first browser, change the delivery fee to `60` and Save. Re-check the config doc: `deliveryEnabled` must still be **`false`** (the cashier's pause survives) and `deliveryFee` must be `60`. This is the race `29ecc62` fixed by re-fetching before save.
6. On https://shareat.net, pick SharEat Lipa, add items, go to checkout. Confirm the ₱50 delivery fee, the ₱200 minimum-order rule, the service-area note, and a **"Ready in about 15 min"**-style line all render.
7. In POS, create 3 active kitchen tickets for Lipa (place a real online order, or start a dine-in session with items so tickets land in `preparing`). Reload the website checkout page. The ETA should rise by roughly **1 minute per active ticket**, capped at baseline + 20 (so ~18 min for 3 tickets).
8. Mark those tickets served/ready in the KDS. Reload checkout again — the ETA should fall back toward the 15-minute baseline.
9. **If the ETA is pinned at 35 (baseline + 20) with an idle kitchen**, do not blame the formula: the count has no time bound, so tickets abandoned in `preparing` count forever. Check with a console collection-group query on `kitchentickets` filtered to `storeId == L5MExycvUOfQ96Y10FqF` and `status == "preparing"`, and compare against what the KDS actually shows.
10. **If the ETA never moves off the baseline**, the count query is failing silently (by design — it degrades rather than 500-ing the whole menu). Check:
    ```powershell
    firebase functions:log --only getStorefrontCatalog --project shareat-website 2>&1 | Select-String "countActiveKitchenTickets"
    ```
    A `FAILED_PRECONDITION` there means the index assumption in Phase 6 is wrong; follow the console link in the log entry to create the exact index — **never** run `firebase deploy --only firestore:indexes`.

---

## Deferred — explicitly not in this plan

Listed so nobody thinks they were missed. Do not implement any of these here.

**From Session 1 (delivery-pricing):**
- Dead write-only `config` React state left in `DeliveryPricingSettings.tsx` after the race fix — cosmetic.
- Narrow residual race between the dialog's fresh re-fetch and its save POST — closing it fully needs a transactional server endpoint; accepted as-is.
- No dedicated automated test file for `DeliveryPricingSettings.tsx` — manually verified instead (steps 2/5 of the smoke test are the manual coverage).

**From Session 3 (security audit) — flag for Ian, both documented in `docs\superpowers\plans\2026-08-12-admin-manager-security-audit.md`:**
- **[Critical, architectural]** No server-side gate on `/admin/**` pages. `src/components/guards/RoleGuard.tsx` is client-only, there is no `src/app/admin/layout.tsx`, and `src/middleware.ts`'s matcher is API-only. Needs server-side session-reading infra that does not exist yet. Audit doc lines 12, 62-63.
- No server-side bounds validation on manager-editable prices/discounts — would need per-field checks across several `firestore.rules` blocks. Audit doc line 98.

**From Session 3 (item-photo):**
- `refreshStoreAddons` (`src/context/store-context.tsx:381`) leaks a Firestore listener subscription on repeated clicks. Pre-existing, confirmed present before this branch. Out of scope of what was authorized.
- No real-device offline verification of the cashier addon-picker photo fallback — code and Firestore SDK source verified only. Open gap; needs a physical till and airplane mode.
- `scripts\cleanup-copied-inventory-images.ts` has never been run. **Verified ready:** dry-run by default (`--apply` required to write), supports `--store=<id>` for a single-store preview, needs `FIREBASE_ADMIN_SA_PATH` set, and points at **production**. Ian's sequence:
  ```powershell
  cd "C:\Users\ianla\webapps\POS"
  npx tsx scripts/cleanup-copied-inventory-images.ts
  npx tsx scripts/cleanup-copied-inventory-images.ts --store=L5MExycvUOfQ96Y10FqF
  npx tsx scripts/cleanup-copied-inventory-images.ts --store=L5MExycvUOfQ96Y10FqF --apply
  npx tsx scripts/cleanup-copied-inventory-images.ts --apply
  ```
  The script prints a reminder to republish affected stores' storefront/customer catalogs afterwards. Not an agent action.

**Repo hygiene:**
- `firestore.indexes.json` is 13 indexes / 0 field overrides vs production's ~57 / 2. Reconciling it is real, reviewable work — see Open Questions #4.

---

## Open questions for Ian

1. **Should `feature/delivery-pricing-dynamic-prep` also go to `sev5_advanced`?** I ported only the item-photo work, since that is what Decision #3 authorized. Argument for sev6-only: the feature's visible payoff is the *dynamic* prep-time ETA, which is computed by the **website's** Cloud Function against live KDS ticket load and rendered on shareat.net — `sev5_advanced` is APK-only and never renders a storefront checkout. What it *would* gain is the manager-facing "Delivery & Pricing" dialog (fee / min-order / baseline prep time), which writes config the website reads regardless of which build saved it — so a manager on the APK could currently set radius and pause delivery but not fee/min-order. Your call: is that gap worth the port? The branch is intact and unpushed if you want it.

2. **Should the `set-config` opt-out fix be ported to `sev5_advanced`?** `sev5_advanced` has `src/app/api/admin/storefront-catalog/route.ts` (via cherry-pick `6454bff`) and therefore has the same landmine. It is unreachable there too (no `set-config` caller on that branch at all, since the dialog is sev6-only), so it is strictly latent. I left it out to keep the port to exactly what you authorized. Trivial to add: cherry-pick that one commit.

3. **Is the website's `getStorefrontCatalog` actually deployed with the prep-time code?** I confirmed the function exists (`v2`, `asia-southeast1`, `nodejs20`) but cannot read its deployed source. `Shareat Website` is on branch `online-order` at `5da69c5`, **1 commit ahead of `origin/online-order`** and **not merged to `main`**. Phase 10 step 5 onward is untestable until this is settled. Also: is `online-order` the branch you deploy from, or does it need to reach `main` first?

4. **Do you want `firestore.indexes.json` reconciled with production?** It currently declares 13 of ~57 live indexes and none of the 2 field overrides, which makes `firebase deploy --only firestore:indexes` a loaded gun for any future agent or for you on autopilot. Fixing it means pulling the live definitions into the file, reviewing each for whether it is still wanted, and deploying once. Not trivial, not urgent, but the drift is only growing.

5. **Timing of the rules deploy vs. your `sev6` push.** Phase 2 deploys rules that tighten `stores/{storeId}` writes, gate `storeConfig`, and restrict `loyaltyRewardImages` uploads — against the **currently deployed** POS build, which predates all of today's work. The audit traced these as safe, but if any live till is doing something the audit missed, it breaks before the matching app code ships. Do you want rules deployed now (as planned, since it closes real authz holes fastest), or held until right after your `sev6` push and App Hosting build so code and rules land together?

6. **Confirm nothing else touched `sev6` after 2026-08-12 20:37.** Session 1 recorded a prior non-fast-forward rejection because you pushed an `apphosting.yaml` commit directly. Right now `sev6` is ahead-only with no divergence, but this plan takes a while to execute — if you push to `origin/sev6` mid-flight, Phase 9 will surface it and stop rather than guess at a reconciliation.

---

### Critical Files for Implementation

- `C:\Users\ianla\webapps\POS\src\app\api\admin\storefront-catalog\route.ts` (line 73 — the `!!c.deliveryEnabled` landmine fix)
- `C:\Users\ianla\webapps\POS\src\app\api\admin\storefront-catalog\route.test.ts` (new file, Phase 4; harness modelled on `src\app\api\admin\online-orders\route.test.ts`)
- `C:\Users\ianla\webapps\POS\firestore.rules` and `C:\Users\ianla\webapps\POS\storage.rules` (the Phase 2 production deploy payload)
- `C:\Users\ianla\webapps\POS\firestore.indexes.json` (13 entries vs ~57 live — the do-not-deploy file)
- `C:\Users\ianla\webapps\POS\docs\superpowers\plans\2026-08-12-item-photo-local-global.md` and `C:\Users\ianla\webapps\POS\docs\superpowers\specs\2026-08-12-item-photo-local-global-design.md` (7 stale Storage-path lines, Phase 5)
