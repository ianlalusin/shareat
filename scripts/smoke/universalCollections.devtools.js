/* eslint-disable */
// =============================================================================
// Universal Discounts & Charges — TEST-store-only backend smoke test
// -----------------------------------------------------------------------------
// HOW TO RUN
//   1. Open the deployed app in your browser, signed in as PLATFORM ADMIN.
//   2. Visit any /admin page so the Firebase client is initialized.
//   3. Open DevTools → Console → paste this whole file → Enter.
//   4. Wait for the SMOKE REPORT banner. The script cleans up after itself.
//
// WHAT IT VERIFIES (pure Firestore — no UI interaction required)
//   - rules + indexes are deployed (can read globalDiscounts / globalCharges)
//   - create universal discount / charge scoped to TEST only, round-trip
//   - array-contains(TEST) returns it; array-contains(other store) does NOT
//   - create a store-scoped discount/charge on TEST; admin-suspend + unsuspend round-trips
//   - applicableStoreIds survives round-trip
//
// WHAT IT DOES NOT VERIFY (requires UI — see companion checklist for that)
//   - auto-sync triggered from the UI updating storeConfig/current
//   - manager-page merge rendering + "Universal" / "Suspended" badges
//   - non-admin write rejection (needs a manager session)
//
// SAFETY
//   - Hard-scoped to the store with name === "TEST" (case-insensitive). Aborts
//     if not found.
//   - Only creates new docs (run-id prefixed names). Never edits existing docs.
//   - Deletes everything it created at the end, even on failure.
// =============================================================================

(async () => {
  const RUN_ID = "smoke_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  const results = { passes: [], fails: [], warnings: [], cleanup: [] };
  const log = (emoji, msg, extra) => console.log(`%c${emoji} ${msg}`, "font-weight: bold;", extra ?? "");
  const pass = (m, x) => { results.passes.push(m); log("✅", m, x); };
  const fail = (m, x) => { results.fails.push(m); log("❌", m, x); };
  const warn = (m, x) => { results.warnings.push(m); log("⚠️ ", m, x); };
  const assert = (cond, ok, bad) => { if (cond) pass(ok); else fail(bad); return !!cond; };

  // -- Firebase SDK (loaded from the deployed app's CDN) ----------------------
  let appMod, authMod, fs;
  try {
    appMod  = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    authMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    fs      = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  } catch (e) {
    console.error("❌ Couldn't load Firebase SDK from gstatic:", e);
    return;
  }
  const apps = appMod.getApps();
  if (apps.length === 0) { console.error("❌ No Firebase app on window. Load the app first."); return; }
  const app = apps[0];
  const db   = fs.getFirestore(app);
  const auth = authMod.getAuth(app);

  if (!auth.currentUser) { console.error("❌ Not signed in. Log in as admin first."); return; }
  log("👤", "Signed in as", auth.currentUser.email || auth.currentUser.uid);

  const { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } = fs;

  const readDoc = async (path) => {
    const parts = path.split("/").filter(Boolean);
    const ref = doc(db, parts[0], ...parts.slice(1));
    const snap = await getDoc(ref);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  };
  const hardDelete = async (path) => {
    const parts = path.split("/").filter(Boolean);
    const ref = doc(db, parts[0], ...parts.slice(1));
    try { await deleteDoc(ref); } catch (e) { console.warn("cleanup failed:", path, e.message); }
  };
  const track = (path) => results.cleanup.push(path);

  try {
    // 1. Find TEST store
    const storesSnap = await getDocs(collection(db, "stores"));
    const all = storesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const TEST = all.find(s => (s.name || "").trim().toLowerCase() === "test");
    if (!TEST) { fail("No store named 'TEST' found — aborting"); return dumpReport(); }
    pass(`Located TEST store: "${TEST.name}" (${TEST.id})`);
    const otherStore = all.find(s => s.id !== TEST.id);

    // 2. Rules/indexes smoke
    try { await getDocs(collection(db, "globalDiscounts")); pass("Can list globalDiscounts"); }
    catch (e) { fail("globalDiscounts list failed — rules not deployed? " + e.message); }
    try { await getDocs(collection(db, "globalCharges")); pass("Can list globalCharges"); }
    catch (e) { fail("globalCharges list failed — rules not deployed? " + e.message); }

    // 3. Create universal discount scoped to TEST only
    const uid = auth.currentUser.uid;
    const udRef = await addDoc(collection(db, "globalDiscounts"), {
      name: `${RUN_ID} Universal Disc 15%`,
      type: "percent", value: 15, scope: ["bill"], stackable: false,
      sortOrder: 999, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      createdBy: uid, updatedBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await updateDoc(udRef, { id: udRef.id });
    track(`globalDiscounts/${udRef.id}`);
    pass(`Created universal discount ${udRef.id}`);

    // 4. TEST-scoped query returns it
    try {
      const udQ = query(
        collection(db, "globalDiscounts"),
        where("applicableStoreIds", "array-contains", TEST.id),
        where("isArchived", "==", false),
      );
      const udSnap = await getDocs(udQ);
      assert(
        udSnap.docs.some(d => d.id === udRef.id),
        "array-contains(TEST) returns the new universal discount",
        "array-contains(TEST) did NOT return the new universal discount",
      );
    } catch (e) {
      fail("composite query failed — index may be missing: " + e.message);
    }

    // 5. Isolation: another store's query does NOT return it
    if (otherStore) {
      const oQ = query(
        collection(db, "globalDiscounts"),
        where("applicableStoreIds", "array-contains", otherStore.id),
        where("isArchived", "==", false),
      );
      const oSnap = await getDocs(oQ);
      assert(
        !oSnap.docs.some(d => d.id === udRef.id),
        `array-contains(${otherStore.name}) correctly excludes the TEST-only universal`,
        `LEAK: universal leaked into ${otherStore.name}'s query`,
      );
    } else {
      warn("Only one store exists — cross-store isolation check skipped");
    }

    // 6. Round-trip applicableStoreIds
    const udBack = await readDoc(`globalDiscounts/${udRef.id}`);
    assert(
      Array.isArray(udBack?.applicableStoreIds) && udBack.applicableStoreIds.includes(TEST.id),
      "applicableStoreIds round-trip includes TEST",
      "applicableStoreIds lost TEST on round-trip",
    );

    // 7. Create universal charge scoped to TEST
    const ucRef = await addDoc(collection(db, "globalCharges"), {
      name: `${RUN_ID} Universal Charge 5%`,
      type: "percent", value: 5, appliesTo: "subtotal",
      sortOrder: 999, isEnabled: true, isArchived: false,
      applicableStoreIds: [TEST.id],
      createdBy: uid, updatedBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await updateDoc(ucRef, { id: ucRef.id });
    track(`globalCharges/${ucRef.id}`);
    pass(`Created universal charge ${ucRef.id}`);

    try {
      const ucSnap = await getDocs(query(
        collection(db, "globalCharges"),
        where("applicableStoreIds", "array-contains", TEST.id),
        where("isArchived", "==", false),
      ));
      assert(
        ucSnap.docs.some(d => d.id === ucRef.id),
        "array-contains(TEST) returns the new universal charge",
        "array-contains(TEST) did NOT return the new universal charge",
      );
    } catch (e) {
      fail("globalCharges composite query failed — index may be missing: " + e.message);
    }

    // 8. Create a store-scoped TEST discount (so we can admin-suspend it)
    const sdRef = await addDoc(collection(db, `stores/${TEST.id}/storeDiscounts`), {
      name: `${RUN_ID} Store Disc 10`,
      type: "fixed", value: 10, scope: ["bill"], stackable: false,
      sortOrder: 998, isEnabled: true, isArchived: false,
      createdBy: uid, updatedBy: uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await updateDoc(sdRef, { id: sdRef.id });
    track(`stores/${TEST.id}/storeDiscounts/${sdRef.id}`);
    pass(`Created store-scoped test discount on TEST ${sdRef.id}`);

    // 9. admin-suspend
    await updateDoc(sdRef, {
      adminSuspended: true,
      adminSuspendedAt: serverTimestamp(),
      adminSuspendedBy: uid,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    let sdBack = await readDoc(`stores/${TEST.id}/storeDiscounts/${sdRef.id}`);
    assert(sdBack?.adminSuspended === true, "adminSuspended=true persisted", "adminSuspended did not persist");
    assert(!!sdBack?.adminSuspendedBy, "adminSuspendedBy recorded", "adminSuspendedBy missing");

    // 10. unsuspend
    await updateDoc(sdRef, {
      adminSuspended: false,
      adminSuspendedAt: null,
      adminSuspendedBy: null,
      updatedBy: uid,
      updatedAt: serverTimestamp(),
    });
    sdBack = await readDoc(`stores/${TEST.id}/storeDiscounts/${sdRef.id}`);
    assert(sdBack?.adminSuspended === false, "unsuspend cleared adminSuspended", "unsuspend did not clear flag");

    // 11. Auto-sync hint — can only verify via UI, so just point at the cache
    const cache = await readDoc(`stores/${TEST.id}/storeConfig/current`);
    if (!cache) {
      warn("stores/TEST/storeConfig/current doesn't exist yet — rebuild has never run for TEST");
    } else {
      const ts = cache.meta?.updatedAt?.toDate?.() || null;
      warn(`Cache exists, last updatedAt: ${ts?.toISOString?.() || "unknown"}. Auto-sync verification requires UI — see companion checklist.`);
    }

    warn("Non-admin write rejection not tested — requires a manager account session");

  } catch (e) {
    fail("Unhandled exception: " + e.message);
    console.error(e);
  } finally {
    log("🧹", `Cleaning up ${results.cleanup.length} docs…`);
    for (const p of results.cleanup) await hardDelete(p);
    log("🧹", "Cleanup done");
    dumpReport();
  }

  function dumpReport() {
    const total = results.passes.length + results.fails.length;
    const banner = `${results.passes.length} pass / ${results.fails.length} fail / ${results.warnings.length} warning (${total} checks)`;
    console.log("\n%c================ SMOKE REPORT ================", "font-weight: bold; font-size: 14px;");
    console.log("%c" + banner, "font-weight: bold; font-size: 13px;");
    if (results.fails.length)    { console.log("%cFails:", "color:#e11;font-weight:bold"); results.fails.forEach(f => console.log("  ❌ " + f)); }
    if (results.warnings.length) { console.log("%cWarnings:", "color:#da0;font-weight:bold"); results.warnings.forEach(w => console.log("  ⚠️  " + w)); }
    if (results.passes.length)   { console.log("%cPasses:", "color:#080;font-weight:bold"); results.passes.forEach(p => console.log("  ✅ " + p)); }
    console.log("================================================\n");
  }
})();
