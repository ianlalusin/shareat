// =============================================================================
// Universal Discounts & Charges — Node smoke test, TEST store ONLY
// -----------------------------------------------------------------------------
// Run:  node scripts/smoke/universalCollections.node.mjs
//
// Safety contract:
//   - Uses firebase-admin (bypasses security rules), so only run against an
//     environment where you're OK reading every collection.
//   - HARD GUARD: every mutation is scoped to the store whose `name` is
//     exactly "TEST" (case-insensitive). If no such store exists, the script
//     aborts before any write.
//   - Only creates new docs (run-id-prefixed names). Never edits existing rows.
//   - Deletes everything it created at the end, even on failure. Restores
//     storeConfig/current to its pre-test contents.
// =============================================================================

import admin from "firebase-admin";
import { readFileSync } from "fs";

const SA_PATH = process.env.SA_PATH || "C:/Users/ianla/webapps/PK/POS.json";
const serviceAccount = JSON.parse(readFileSync(SA_PATH, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const RUN_ID = "smoke_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
const results = { passes: [], fails: [], warnings: [] };
const cleanup = []; // array of refs (or { ref, originalData } for restores)
let storeConfigBackup = null; // { ref, data|null }

const pass = (m) => { results.passes.push(m); console.log("✅ " + m); };
const fail = (m) => { results.fails.push(m); console.log("❌ " + m); };
const warn = (m) => { results.warnings.push(m); console.log("⚠️  " + m); };
const assert = (cond, ok, bad) => { cond ? pass(ok) : fail(bad); return !!cond; };

async function run() {
  console.log(`\n🧪 Run ID: ${RUN_ID}\n`);

  // ------------------------------------------------------------------ 1. TEST
  const storesSnap = await db.collection("stores").get();
  const all = storesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const TEST = all.find(s => (s.name || "").trim().toLowerCase() === "test");
  if (!TEST) {
    fail(`No store named 'TEST' found (scanned ${all.length} stores). Aborting before any write.`);
    return dump();
  }
  pass(`Located TEST store: "${TEST.name}" (id: ${TEST.id})`);
  const otherStore = all.find(s => s.id !== TEST.id);
  console.log(`    (${all.length} stores total; other sample: ${otherStore ? otherStore.name : "none"})`);

  // ------------------------------------------------------------- 2. Pre-state
  const pretestGlobalDiscountIds = new Set(
    (await db.collection("globalDiscounts").get()).docs.map(d => d.id)
  );
  const pretestGlobalChargeIds = new Set(
    (await db.collection("globalCharges").get()).docs.map(d => d.id)
  );
  const pretestTestDiscountIds = new Set(
    (await db.collection(`stores/${TEST.id}/storeDiscounts`).get()).docs.map(d => d.id)
  );
  const pretestTestChargeIds = new Set(
    (await db.collection(`stores/${TEST.id}/storeCharges`).get()).docs.map(d => d.id)
  );
  pass(`Pre-state captured: ${pretestGlobalDiscountIds.size} globalDiscounts, ${pretestGlobalChargeIds.size} globalCharges, ${pretestTestDiscountIds.size} TEST storeDiscounts, ${pretestTestChargeIds.size} TEST storeCharges`);

  // Back up TEST storeConfig/current so we can restore it
  const cfgRef = db.doc(`stores/${TEST.id}/storeConfig/current`);
  const cfgSnap = await cfgRef.get();
  storeConfigBackup = { ref: cfgRef, data: cfgSnap.exists ? cfgSnap.data() : null };
  pass(`storeConfig/current backup captured (existed: ${cfgSnap.exists})`);

  try {
    // -------------------------------------------- 3. Create universal discount
    const udRef = await db.collection("globalDiscounts").add({
      name: `${RUN_ID} Universal Disc 15%`,
      type: "percent", value: 15, scope: ["bill"], stackable: false,
      sortOrder: 999, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await udRef.update({ id: udRef.id });
    cleanup.push(udRef);
    pass(`Created universal discount ${udRef.id}`);

    // --------------------------- 4. array-contains(TEST) returns the universal
    let udQSnap;
    try {
      udQSnap = await db.collection("globalDiscounts")
        .where("applicableStoreIds", "array-contains", TEST.id)
        .where("isArchived", "==", false)
        .get();
      assert(
        udQSnap.docs.some(d => d.id === udRef.id),
        "array-contains(TEST) returns the new universal discount",
        "array-contains(TEST) did NOT return the new universal discount",
      );
    } catch (e) {
      fail(`Composite query failed — index likely not deployed: ${e.message}`);
    }

    // --------------------------- 5. Isolation: other store query excludes it
    if (otherStore) {
      try {
        const oSnap = await db.collection("globalDiscounts")
          .where("applicableStoreIds", "array-contains", otherStore.id)
          .where("isArchived", "==", false)
          .get();
        assert(
          !oSnap.docs.some(d => d.id === udRef.id),
          `array-contains(${otherStore.name}) correctly excludes the TEST-only universal`,
          `LEAK: universal leaked into ${otherStore.name}'s query`,
        );
      } catch (e) {
        fail(`Isolation query failed: ${e.message}`);
      }
    } else {
      warn("Only one store exists — cross-store isolation check skipped");
    }

    // --------------------------- 6. Round-trip applicableStoreIds
    const udBack = (await udRef.get()).data();
    assert(
      Array.isArray(udBack?.applicableStoreIds) && udBack.applicableStoreIds.includes(TEST.id),
      "applicableStoreIds round-trip includes TEST",
      "applicableStoreIds lost TEST on round-trip",
    );

    // --------------------------- 7. Create universal charge scoped to TEST (bill-level)
    const ucRef = await db.collection("globalCharges").add({
      name: `${RUN_ID} Universal Charge 5%`,
      type: "percent", value: 5, appliesTo: "subtotal",
      scope: ["bill"],
      sortOrder: 999, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ucRef.update({ id: ucRef.id });
    cleanup.push(ucRef);
    pass(`Created universal charge (bill-scope) ${ucRef.id}`);

    try {
      const ucSnap = await db.collection("globalCharges")
        .where("applicableStoreIds", "array-contains", TEST.id)
        .where("isArchived", "==", false)
        .get();
      assert(
        ucSnap.docs.some(d => d.id === ucRef.id),
        "array-contains(TEST) returns the new universal charge",
        "array-contains(TEST) did NOT return the new universal charge",
      );
    } catch (e) {
      fail(`globalCharges composite query failed: ${e.message}`);
    }

    // --------------------------- 7b. Create an ITEM-scoped universal charge
    const icRef = await db.collection("globalCharges").add({
      name: `${RUN_ID} Universal Item Charge`,
      type: "fixed", value: 2, appliesTo: "subtotal",
      scope: ["item"],
      sortOrder: 998, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await icRef.update({ id: icRef.id });
    cleanup.push(icRef);
    pass(`Created item-scope universal charge ${icRef.id}`);

    const icBack = (await icRef.get()).data();
    assert(
      Array.isArray(icBack?.scope) && icBack.scope.includes("item") && !icBack.scope.includes("bill"),
      "item-scope universal charge scope round-trips as ['item']",
      "item-scope did NOT round-trip correctly",
    );

    // --------------------------- 8. Store-scoped test discount on TEST
    const sdRef = await db.collection(`stores/${TEST.id}/storeDiscounts`).add({
      name: `${RUN_ID} Store Disc 10`,
      type: "fixed", value: 10, scope: ["bill"], stackable: false,
      sortOrder: 998, isEnabled: true, isArchived: false,
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await sdRef.update({ id: sdRef.id });
    cleanup.push(sdRef);
    pass(`Created TEST store-scoped discount ${sdRef.id}`);

    // --------------------------- 9. admin-suspend persists + round-trips
    await sdRef.update({
      adminSuspended: true,
      adminSuspendedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminSuspendedBy: "smoke-node",
      updatedBy: "smoke-node",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    let sdBack = (await sdRef.get()).data();
    assert(sdBack.adminSuspended === true, "adminSuspended=true persisted", "adminSuspended did not persist");
    assert(!!sdBack.adminSuspendedBy, "adminSuspendedBy recorded", "adminSuspendedBy missing");

    // --------------------------- 10. unsuspend clears
    await sdRef.update({
      adminSuspended: false,
      adminSuspendedAt: null,
      adminSuspendedBy: null,
      updatedBy: "smoke-node",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    sdBack = (await sdRef.get()).data();
    assert(sdBack.adminSuspended === false, "unsuspend cleared adminSuspended", "unsuspend did not clear flag");

    // --------------------------- 11. rebuildStoreConfig logic: Node replica
    // The client-side rebuildStoreConfig can't be imported from Node. Re-
    // implement the merge here to prove the logic produces the correct cache.
    await sdRef.update({
      adminSuspended: true, // re-suspend for the rebuild check
      adminSuspendedAt: admin.firestore.FieldValue.serverTimestamp(),
      adminSuspendedBy: "smoke-node",
      updatedBy: "smoke-node",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const [storeDiscSnap, storeChgSnap, gdSnap2, gcSnap2] = await Promise.all([
      db.collection(`stores/${TEST.id}/storeDiscounts`).get(),
      db.collection(`stores/${TEST.id}/storeCharges`).get(),
      db.collection("globalDiscounts").where("applicableStoreIds", "array-contains", TEST.id).where("isArchived", "==", false).get(),
      db.collection("globalCharges").where("applicableStoreIds", "array-contains", TEST.id).where("isArchived", "==", false).get(),
    ]);
    const mergedDiscounts = [
      ...storeDiscSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(d => !d.adminSuspended && !d.isArchived)
        .map(d => ({ ...d, source: "store" })),
      ...gdSnap2.docs.map(d => {
        const { applicableStoreIds, ...rest } = { id: d.id, ...d.data() };
        return { ...rest, source: "global" };
      }),
    ];
    const mergedCharges = [
      ...storeChgSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(c => !c.adminSuspended && !c.isArchived)
        .map(c => ({ ...c, source: "store" })),
      ...gcSnap2.docs.map(d => {
        const { applicableStoreIds, ...rest } = { id: d.id, ...d.data() };
        return { ...rest, source: "global" };
      }),
    ];

    assert(
      mergedDiscounts.some(d => d.id === udRef.id && d.source === "global"),
      "Merged cache includes the universal discount tagged source=global",
      "Merged cache missing the universal discount",
    );
    assert(
      mergedCharges.some(c => c.id === ucRef.id && c.source === "global"),
      "Merged cache includes the bill-scope universal charge tagged source=global",
      "Merged cache missing the universal bill-scope charge",
    );
    assert(
      mergedCharges.some(c => c.id === icRef.id && c.source === "global" && Array.isArray(c.scope) && c.scope.includes("item")),
      "Merged cache includes the item-scope universal charge with scope preserved",
      "Merged cache missing the item-scope universal charge (or lost scope field)",
    );

    // Scope-split verification (what session-detail-view.tsx will do at runtime)
    const billCharges = mergedCharges.filter(c => {
      const s = c.scope;
      if (!s) return true; // legacy default → bill
      const arr = Array.isArray(s) ? s : [s];
      return arr.includes("bill");
    });
    const itemCharges = mergedCharges.filter(c => {
      const s = c.scope;
      if (!s) return false;
      const arr = Array.isArray(s) ? s : [s];
      return arr.includes("item");
    });
    assert(
      billCharges.some(c => c.id === ucRef.id) && !billCharges.some(c => c.id === icRef.id),
      "billCharges filter includes bill-scope, excludes item-only charge",
      "billCharges scope split is incorrect",
    );
    assert(
      itemCharges.some(c => c.id === icRef.id) && !itemCharges.some(c => c.id === ucRef.id),
      "itemCharges filter includes item-scope, excludes bill-only charge",
      "itemCharges scope split is incorrect",
    );
    assert(
      !mergedDiscounts.some(d => d.id === sdRef.id),
      "Merged cache excludes the admin-suspended store-scoped discount",
      "Merged cache still contained suspended discount — filter broken",
    );

    // --------------------------- 11b. Date-gated universal discount (scheduled/active/expired)
    const today = new Date();
    const toISO = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    };
    const yesterday = new Date(today.getTime() - 86400000);
    const tomorrow  = new Date(today.getTime() + 86400000);
    const twoDays   = new Date(today.getTime() + 86400000 * 2);

    // Active window: yesterday..tomorrow → today is inside
    const activeWindowRef = await db.collection("globalDiscounts").add({
      name: `${RUN_ID} Dated Active`,
      type: "percent", value: 5, scope: ["bill"], stackable: false,
      sortOrder: 997, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      startDate: toISO(yesterday), endDate: toISO(tomorrow),
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await activeWindowRef.update({ id: activeWindowRef.id });
    cleanup.push(activeWindowRef);

    // Future window: tomorrow..twoDays → today is before start
    const futureRef = await db.collection("globalDiscounts").add({
      name: `${RUN_ID} Dated Future`,
      type: "percent", value: 5, scope: ["bill"], stackable: false,
      sortOrder: 996, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      startDate: toISO(tomorrow), endDate: toISO(twoDays),
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await futureRef.update({ id: futureRef.id });
    cleanup.push(futureRef);

    // Past window: two-days-ago..yesterday → today is after end
    const pastStart = new Date(today.getTime() - 86400000 * 2);
    const expiredRef = await db.collection("globalDiscounts").add({
      name: `${RUN_ID} Dated Expired`,
      type: "percent", value: 5, scope: ["bill"], stackable: false,
      sortOrder: 995, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      startDate: toISO(pastStart), endDate: toISO(yesterday),
      createdBy: "smoke-node", updatedBy: "smoke-node",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await expiredRef.update({ id: expiredRef.id });
    cleanup.push(expiredRef);

    // Replicate client helper logic
    const todayStr = toISO(today);
    const isActive = (d) => {
      if (d.startDate && todayStr < d.startDate) return false;
      if (d.endDate && todayStr > d.endDate) return false;
      return true;
    };
    const dStatus = (d) => {
      if (!d.startDate && !d.endDate) return "always-on";
      if (d.startDate && todayStr < d.startDate) return "scheduled";
      if (d.endDate && todayStr > d.endDate) return "expired";
      return "active";
    };

    const activeWinBack = (await activeWindowRef.get()).data();
    const futureBack    = (await futureRef.get()).data();
    const expiredBack   = (await expiredRef.get()).data();

    assert(isActive(activeWinBack), "Dated Active discount is in-window today",    "Dated Active WRONGLY out-of-window");
    assert(!isActive(futureBack),   "Dated Future discount is NOT active today",   "Dated Future WRONGLY active");
    assert(!isActive(expiredBack),  "Dated Expired discount is NOT active today",  "Dated Expired WRONGLY active");
    assert(dStatus(activeWinBack) === "active",    `Status of Active window resolves to 'active'`,    `Got ${dStatus(activeWinBack)}`);
    assert(dStatus(futureBack) === "scheduled",    `Status of Future window resolves to 'scheduled'`, `Got ${dStatus(futureBack)}`);
    assert(dStatus(expiredBack) === "expired",     `Status of Past window resolves to 'expired'`,     `Got ${dStatus(expiredBack)}`);

    // Confirm that, when merged into the effective POS list, only the active one flows through
    const posEligible = [activeWinBack, futureBack, expiredBack].filter(isActive);
    assert(
      posEligible.length === 1 && posEligible[0].id === activeWindowRef.id,
      "POS runtime filter keeps only the in-window dated discount",
      "POS runtime filter included an out-of-window discount",
    );

    // --------------------------- 12. Archive universal → removed from query
    await udRef.update({
      isArchived: true,
      updatedBy: "smoke-node",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const afterArchive = await db.collection("globalDiscounts")
      .where("applicableStoreIds", "array-contains", TEST.id)
      .where("isArchived", "==", false)
      .get();
    assert(
      !afterArchive.docs.some(d => d.id === udRef.id),
      "Archived universal no longer returned by TEST-store query",
      "Archived universal still returned — filter broken",
    );

    // --------------------------- 13. Rules deployment hint (can't write rules from admin SDK)
    warn("Security rules deployment not testable via admin SDK (it bypasses rules). Verify 'firebase deploy --only firestore:rules' was run so managers are rejected on globalDiscounts writes.");

    // --------------------------- 14. Index presence already proved by step 4/5/7/12 queries completing without error

  } catch (e) {
    fail("Unhandled exception: " + e.message);
    console.error(e);
  } finally {
    console.log(`\n🧹 Cleaning up ${cleanup.length} docs…`);
    for (const ref of cleanup) {
      try { await ref.delete(); }
      catch (e) { console.warn(`cleanup failed: ${ref.path}:`, e.message); }
    }

    // Restore storeConfig/current if we had backed it up (we actually didn't
    // modify it — but restore defensively in case a future change writes to it)
    if (storeConfigBackup) {
      try {
        const now = await storeConfigBackup.ref.get();
        if (storeConfigBackup.data === null && now.exists) {
          await storeConfigBackup.ref.delete();
          console.log("   restored: storeConfig/current deleted (was absent pre-test)");
        } else if (storeConfigBackup.data !== null) {
          const beforeJson = JSON.stringify(storeConfigBackup.data);
          const afterJson = JSON.stringify(now.exists ? now.data() : null);
          if (beforeJson !== afterJson) {
            await storeConfigBackup.ref.set(storeConfigBackup.data, { merge: false });
            console.log("   restored: storeConfig/current reverted to pre-test contents");
          }
        }
      } catch (e) {
        console.warn("storeConfig restore failed:", e.message);
      }
    }

    // Post-cleanup audit: ensure we didn't leak docs
    const postGlobalDisc = new Set((await db.collection("globalDiscounts").get()).docs.map(d => d.id));
    const postGlobalChg  = new Set((await db.collection("globalCharges").get()).docs.map(d => d.id));
    const postTestDisc   = new Set((await db.collection(`stores/${TEST.id}/storeDiscounts`).get()).docs.map(d => d.id));
    const postTestChg    = new Set((await db.collection(`stores/${TEST.id}/storeCharges`).get()).docs.map(d => d.id));

    const leaks = [];
    for (const id of postGlobalDisc) if (!pretestGlobalDiscountIds.has(id)) leaks.push(`globalDiscounts/${id}`);
    for (const id of postGlobalChg)  if (!pretestGlobalChargeIds.has(id))   leaks.push(`globalCharges/${id}`);
    for (const id of postTestDisc)   if (!pretestTestDiscountIds.has(id))   leaks.push(`stores/${TEST.id}/storeDiscounts/${id}`);
    for (const id of postTestChg)    if (!pretestTestChargeIds.has(id))     leaks.push(`stores/${TEST.id}/storeCharges/${id}`);

    if (leaks.length === 0) pass("Cleanup verified: no leaked docs");
    else fail(`Leaked ${leaks.length} docs after cleanup: ${leaks.join(", ")}`);

    // Check that no OTHER store was touched (length counts match)
    for (const s of all.filter(x => x.id !== TEST.id)) {
      // we never wrote to other stores, but let's confirm we didn't read unexpectedly — this is a no-op
    }

    dump();
    process.exit(results.fails.length > 0 ? 1 : 0);
  }
}

function dump() {
  const total = results.passes.length + results.fails.length;
  console.log("\n================ SMOKE REPORT ================");
  console.log(`${results.passes.length} pass / ${results.fails.length} fail / ${results.warnings.length} warning (${total} checks)`);
  if (results.fails.length)    { console.log("\nFails:");    results.fails.forEach(f => console.log("  ❌ " + f)); }
  if (results.warnings.length) { console.log("\nWarnings:"); results.warnings.forEach(w => console.log("  ⚠️  " + w)); }
  if (results.passes.length)   { console.log("\nPasses:");   results.passes.forEach(p => console.log("  ✅ " + p)); }
  console.log("================================================\n");
}

run().catch(e => { console.error("FATAL:", e); process.exit(1); });
