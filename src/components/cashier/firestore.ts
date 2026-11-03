

'use client';

import {
  collection,
  doc,
  serverTimestamp,
  getDocs,
  getDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  orderBy,
  deleteField,
  increment,
  type DocumentReference,
  type DocumentSnapshot,
  type DocumentData,
  type Firestore,
  type Transaction,
  type WriteBatch,
  arrayUnion,
  arrayRemove,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

import { db, auth } from '@/lib/firebase/client';
import { selectTicketWriter } from '@/lib/offline/kitchenTicketWrites';
import { servedQtyFields } from '@/lib/kitchen/served-qty';
import { AppUser } from '@/context/auth-context';
import type {
  Store,
  StorePackage,
  Payment,
  ModeOfPayment,
  SessionBillLine,
  Discount,
  Adjustment,
  SessionLoyaltyRedemption,
  ReceiptAnalyticsV2,
  Receipt,
  KitchenTicket,
  LineAdjustment,
  PendingSession,
  OrderItemType,
} from '@/lib/types';

import { stripUndefined } from '@/lib/firebase/utils';
import { printKitchenTicketBackup } from '@/lib/printing/kitchenBackupPrint';
import { makeKitchenBackupDeps } from '@/lib/printing/kitchenBackupDeps';
import { roundMoney } from '@/lib/money';
import { postPosCommand } from '@/lib/pos-commands/client';
import { computeSessionLabel } from '@/lib/utils/session';
import { writeActivityLog } from '@/components/cashier/activity-log';
import { commitLocalFirst } from '@/lib/offline/commit';
import { sessionOwnershipFields } from '@/lib/offline/sessionOwnership';
import { planGatewayChecks, verifyBridgeTender, verifyReservationTender, type CheckoutPayment } from '@/components/cashier/gatewayTenders';
import { getBrowserDeviceId } from '@/lib/offline/browserDevice';
import { getActiveLocalProfile } from '@/lib/server-profiles/activeLocalProfile';
import { calculateBillTotals } from '@/lib/tax';
import { bundleExtraPax } from '@/lib/billing/bundle';
import { v4 as uuidv4 } from 'uuid';
import { applyAnalyticsDeltaV2 } from '@/lib/analytics/applyAnalyticsDeltaV2';
import { applyReceiptDeltaServerFirst } from '@/lib/analytics/applyReceiptDeltaServerFirst';
import { quoteRefund, normalizeQty } from '@/lib/analytics/refund-quote';
import { lineItemAmounts } from '@/lib/analytics/line-amounts';
import { applyKdsTicketDelta } from '@/lib/analytics/applyKdsTicketDelta';
import { applyKdsDeltaServerFirst } from '@/lib/analytics/applyKdsDeltaServerFirst';
import { computeKdsTargets } from '@/lib/analytics/kdsTargets';
import { toJsDate } from '@/lib/utils/date';
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

export type ActorStamp = { uid: string; username: string; email?: string | null };

export function getActorStamp(user: AppUser): ActorStamp {
  // Prefer the device's signed-in local profile — the actual cashier/server operating
  // the POS — for the display name. Admin/manager bypass the local-user gate, so for
  // them this is null and we fall back to their own account name. The receipt's
  // CASHIER line and all action attribution should read the operator, not the
  // shared/admin login. uid stays the authenticated account for audit integrity.
  const localName = getActiveLocalProfile()?.name?.trim();
  const username =
    localName ||
    (user.displayName && user.displayName.trim()) ||
    ((user as any).name && String((user as any).name).trim()) ||
    (user.email ? user.email.split('@')[0] : '') ||
    user.uid.slice(0, 6);

  return { uid: user.uid, username, email: user.email ?? null };
}

export type StartSessionPayload = {
  tableId: string;
  tableNumber: string;
  displayName?: string;
  guestCount: number;
  customer?: { name?: string | null; tin?: string | null; address?: string | null };
  notes?: string;
  initialFlavorIds?: string[];
  package?: StorePackage; // Optional for ala carte
  sessionMode: 'package_dinein' | 'alacarte';
};


/**
 * Formats a receipt number based on a template and a sequence number.
 * @param fmt The format string (e.g., "PREFIX-#####").
 * @param seq The sequence number.
 * @returns The formatted receipt number string.
 */
function formatReceiptNumber(fmt: string, seq: number): string {
  const m = fmt.match(/#+/g);
  if (!m) return `${fmt}${seq}`;

  const run = m.sort((a, b) => b.length - a.length)[0];
  const padded = String(seq).padStart(run.length, '0');
  return fmt.replace(run, padded);
}

export async function getCurrentSessionBillingState(storeId: string, sessionId: string) {
  const sessionRef = doc(db, `stores/${storeId}/sessions`, sessionId);
  const linesRef = query(
    collection(db, `stores/${storeId}/sessions/${sessionId}/sessionBillLines`),
    orderBy("createdAt", "asc"),
  );
  const [sessionSnap, linesSnap] = await Promise.all([getDoc(sessionRef), getDocs(linesRef)]);
  const sessionData = sessionSnap.data() as PendingSession | undefined;
  if (!sessionData) throw new Error(`Session ${sessionId} does not exist.`);
  return {
    billingRevision: Number((sessionData as any).billingRevision ?? 0),
    billDiscount: ((sessionData as any).billDiscount ?? null) as Discount | null,
    customAdjustments: Array.isArray((sessionData as any).customAdjustments)
      ? ((sessionData as any).customAdjustments as Adjustment[])
      : [],
    loyaltyRedemptions: (Array.isArray((sessionData as any).loyaltyRedemptions)
      ? (sessionData as any).loyaltyRedemptions
      : []) as SessionLoyaltyRedemption[],
    billLines: linesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as SessionBillLine)),
  };
}

/**
 * Starts a new dining session.
 * Creates session doc, table update, and initial kitchen/billing units.
 */
export async function startSession(storeId: string, payload: StartSessionPayload, user: AppUser) {
  const newSessionRef = doc(collection(db, `stores/${storeId}/sessions`));

  const isAlaCarte = payload.sessionMode === 'alacarte';
  const customerName = payload.customer?.name ?? null;
  const tableNumber = isAlaCarte ? null : payload.tableNumber;
  const tableDisplayName = payload.displayName || `Table ${payload.tableNumber}`;
  const sessionLabel = computeSessionLabel({ sessionMode: payload.sessionMode, customerName, tableDisplayName: tableDisplayName });

  // Bundle packages bill as a single flat-priced unit (qty 1 @ bundlePrice)
  // while the entered guestCount stays the headcount that drives PINs, covers,
  // kitchen prep, and analytics.
  const isBundle = !!payload.package?.isBundle;
  const bundlePrice = Number(payload.package?.bundlePrice ?? 0);
  const bundleMaxCap = Number(payload.package?.bundleMaxCap ?? 0);
  const bundleExtraHeadPrice = Number(payload.package?.bundleExtraHeadPrice ?? 0);
  const packageSnapshot = payload.package
    ? {
        name: payload.package.packageName,
        pricePerHead: payload.package.pricePerHead,
        ...(isBundle ? { isBundle: true, bundlePrice, bundleMaxCap, bundleExtraHeadPrice } : {}),
      }
    : null;

  const ownership = sessionOwnershipFields(getBrowserDeviceId());

  const sessionPayload = stripUndefined({
    id: newSessionRef.id,
    ...ownership,
    storeId,
    tableId: payload.tableId,
    tableNumber,
    tableDisplayName,
    customerName,
    sessionLabel,
    status: isAlaCarte ? 'active' : 'pending_verification',
    sessionMode: payload.sessionMode,
    isPaid: false,
    startedAt: serverTimestamp(),
    startedAtClientMs: Date.now(),
    startedByUid: user.uid,
    guestCountCashierInitial: payload.guestCount,
    guestCountServerVerified: null,
    guestCountFinal: isAlaCarte ? null : payload.guestCount,
    guestCountVerifyLocked: isAlaCarte,
    verifiedAt: null,
    verifiedByUid: null,
    packageOfferingId: payload.package?.packageId || null,
    packageSnapshot,
    initialFlavorIds: payload.initialFlavorIds || [],
    customer: payload.customer,
    notes: payload.notes || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Captured when the package-ticket path below builds a ticket, so the
  // offline backup print (fired after commitLocalFirst) has a payload to
  // print without re-deriving it.
  let packageTicketPayload: Record<string, any> | null = null;

  const batch = writeBatch(db);
    // 1. Create the new session document
    batch.set(newSessionRef, sessionPayload);

    // 2. Update the table document and its projection if not ala carte
    if (!isAlaCarte) {
      const tableRef = doc(db, `stores/${storeId}/tables`, payload.tableId);
      batch.update(tableRef, {
        status: 'occupied',
        currentSessionId: newSessionRef.id,
        updatedAt: serverTimestamp(),
      });
      
      const tableProjectionRef = doc(db, `stores/${storeId}/storeConfig/current/tables`, payload.tableId);
      batch.update(tableProjectionRef, {
        status: 'occupied',
        currentSessionId: newSessionRef.id,
        customerName: customerName,
        packageLabel: payload.package?.packageName || null,
        sessionType: payload.sessionMode,
        guestCount: payload.guestCount,
        startedAtMs: sessionPayload.startedAtClientMs,
        updatedAt: serverTimestamp(),
      });
    }

    // 3. Write session projection to the new location
    const sessionProjectionRef = doc(db, `stores/${storeId}/activeSessions`, newSessionRef.id);
    const projectionPayload = {
      id: newSessionRef.id,
      ...ownership,
      status: isAlaCarte ? 'active' : 'pending_verification',
      sessionMode: payload.sessionMode,
      tableId: payload.tableId,
      tableNumber: isAlaCarte ? null : payload.tableNumber,
      tableDisplayName: isAlaCarte ? null : tableDisplayName,
      customerName: customerName,
      packageOfferingId: payload.package?.packageId || null,
      packageName: payload.package?.packageName || null, // Denormalize for server page
      packageSnapshot,
      guestCountCashierInitial: payload.guestCount,
      guestCountFinal: isAlaCarte ? null : payload.guestCount,
      startedAt: serverTimestamp(),
      startedAtClientMs: sessionPayload.startedAtClientMs,
      updatedAt: serverTimestamp(),
      initialFlavorIds: payload.initialFlavorIds || [],
    };
    batch.set(sessionProjectionRef, projectionPayload);


    // 4. Create package bill line and kitchen ticket if applicable
    if (payload.sessionMode === 'package_dinein' && payload.package) {
      const lineId = `package_${payload.package.packageId}`;
      const lineRef = doc(db, `stores/${storeId}/sessions/${newSessionRef.id}/sessionBillLines`, lineId);
      batch.set(lineRef, {
        id: lineId,
        type: 'package',
        itemId: payload.package.packageId,
        itemName: payload.package.packageName,
        // Bundle: one flat-priced unit. Per-head: pricePerHead × guestCount.
        unitPrice: isBundle ? bundlePrice : payload.package.pricePerHead,
        qtyOrdered: isBundle ? 1 : payload.guestCount,
        discountType: null,
        discountValue: 0,
        discountQty: 0,
        freeQty: 0,
        voidedQty: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: user.uid,
        updatedByName: getActorStamp(user).username,
      });

      // Bundle overflow: guests beyond the cap are billed per-head on a separate
      // "Extra Pax" addon line. Only when the bundle has an extra-head price.
      const extraQty = bundleExtraPax(payload.guestCount, bundleMaxCap);
      if (isBundle && bundleExtraHeadPrice > 0 && extraQty > 0) {
        const extraLineId = `bundleextra_${payload.package.packageId}`;
        const extraLineRef = doc(db, `stores/${storeId}/sessions/${newSessionRef.id}/sessionBillLines`, extraLineId);
        batch.set(extraLineRef, {
          id: extraLineId,
          type: 'addon',
          itemId: extraLineId,
          itemName: `Extra Pax — ${payload.package.packageName}`,
          category: 'Extra Pax',
          unitPrice: bundleExtraHeadPrice,
          qtyOrdered: extraQty,
          discountType: null,
          discountValue: 0,
          discountQty: 0,
          freeQty: 0,
          voidedQty: 0,
          kitchenLocationId: null,
          kitchenLocationName: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedByUid: user.uid,
          updatedByName: getActorStamp(user).username,
        });
      }

      const stationKey = payload.package.kitchenLocationId;
      if (!stationKey) {
        throw new Error(`Package with ID ${payload.package.packageId} does not have a kitchen location assigned.`);
      }
      const ticketRef = doc(collection(db, 'stores', storeId, 'sessions', newSessionRef.id, 'kitchentickets'));
      const ticketPayload = stripUndefined({
        id: ticketRef.id,
        sessionId: newSessionRef.id,
        storeId,
        tableId: payload.tableId,
        tableNumber: payload.tableNumber,
        tableDisplayName: tableDisplayName,
        type: 'package',
        itemId: payload.package.packageId,
        itemName: payload.package.packageName,
        guestCount: payload.guestCount,
        status: 'preparing',
        kitchenLocationId: stationKey,
        kitchenLocationName: payload.package.kitchenLocationName,
        notes: payload.notes || '',
        qty: 1,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        createdAtClientMs: Date.now(),
        sessionMode: 'package_dinein',
        customerName: payload.customer?.name,
        sessionLabel,
        initialFlavorIds: payload.initialFlavorIds,
      });
      batch.set(ticketRef, ticketPayload);
      packageTicketPayload = ticketPayload;

      // KDS PROJECTION WRITE
      const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", stationKey);
      batch.set(rtKdsDocRef, {
        meta: { source: 'startSession', updatedAt: serverTimestamp() },
        kitchenLocationId: stationKey,
      }, { merge: true });
      batch.update(rtKdsDocRef, {
          [`tickets.${ticketRef.id}`]: ticketPayload,
          activeIds: arrayUnion(ticketRef.id),
          [`sessionIndex.${newSessionRef.id}`]: arrayUnion(ticketRef.id)
      });
    }

  commitLocalFirst(batch, (err) => {
    console.error('[startSession] batch sync failed', err);
  });

  // Fire-and-forget backup print to the shared kitchen Bluetooth printer.
  // startSession has no React `isOnline` (it's a plain data-layer function),
  // so it gates directly on navigator.onLine. Never awaited into the order
  // flow; any dep (or the kitchenLocations fetch) throwing is swallowed.
  if (typeof navigator !== 'undefined' && !navigator.onLine && packageTicketPayload) {
    const ticketToPrint = packageTicketPayload;
    void (async () => {
      const klSnap = await getDocs(collection(db, 'stores', storeId, 'kitchenLocations'));
      const kitchenLocations = klSnap.docs.map((d) => ({ id: d.id, printOnOutage: (d.data() as any).printOnOutage }));
      const deps = makeKitchenBackupDeps({
        kitchenLocations,
        stampTicket: (ticketId) => {
          const ref = doc(db, 'stores', storeId, 'sessions', newSessionRef.id, 'kitchentickets', ticketId);
          void updateDoc(ref, { printedOffline: true, printedOfflineAt: Date.now(), printedOfflineDevice: getBrowserDeviceId() }).catch(() => {});
          // Also patch the rtKdsTickets projection the KDS page actually reads
          // from, so the auto-ack effect there can see the stamp.
          const _stationId = ticketToPrint.kitchenLocationId;
          if (_stationId) {
            void updateDoc(doc(db, 'stores', storeId, 'rtKdsTickets', _stationId), {
              [`tickets.${ticketId}.printedOffline`]: true,
              [`tickets.${ticketId}.printedOfflineAt`]: Date.now(),
            }).catch(() => {});
          }
        },
        alert: (message) => console.warn(`[startSession] ${message}`),
      });
      await printKitchenTicketBackup(ticketToPrint as any, deps);
    })().catch(() => {});
  }

  const packageName = payload.package?.packageName || null;
  const guestCount = payload.guestCount ?? 0;
  const startedNote = payload.sessionMode === 'alacarte'
    ? `Session started (Ala Carte)`
    : `Started: ${packageName || 'Package'} · ${guestCount} pax (cashier)`;

  void writeActivityLog({
    storeId,
    sessionId: newSessionRef.id,
    user,
    action: 'SESSION_STARTED',
    note: startedNote,
    qty: guestCount,
    meta: {
      itemName: packageName ?? undefined,
      qty: guestCount,
      cashierGuestCount: guestCount,
    } as any,
    sessionContext: {
      sessionStatus: sessionPayload.status as any,
      sessionStartedAt: sessionPayload.startedAt,
      sessionMode: sessionPayload.sessionMode ?? undefined,
      customerName: sessionPayload.customerName,
      tableNumber: sessionPayload.tableNumber,
      tableDisplayName: tableDisplayName ?? null,
    }
  }).catch((err) => console.warn('[startSession] activity log sync failed', err));

  return newSessionRef.id;
}


/**
 * Completes a payment and closes the dining session through the authoritative
 * server command (audit P1: B01/B03). The server re-reads the bill, recomputes
 * the total, verifies + consumes gateway tenders, numbers the receipt and runs
 * the deferred effects (analytics, KDS, PIN, loyalty) from its outbox. The
 * client only proposes tenders; `opId` makes a retry return the same receipt.
 */
export async function completePaymentFromUnits(
  storeId: string,
  sessionId: string,
  user: AppUser,
  payments: CheckoutPayment[],
  store: Store,
  paymentMethods: ModeOfPayment[],
  expectedTotal?: number,
  opId: string = uuidv4(),
) {
  // Fast local rejection of bad amounts / unlinked gateway rows; the server
  // repeats every check authoritatively.
  planGatewayChecks(payments, paymentMethods);
  const billingState = await getCurrentSessionBillingState(storeId, sessionId);
  const { billLines, billDiscount, customAdjustments, loyaltyRedemptions } = billingState;
  const loyaltyDiscountInput = (loyaltyRedemptions || []).map((r) => ({ type: r.type, value: r.value }));
  const amountDue = calculateBillTotals(billLines, store, billDiscount, customAdjustments, loyaltyDiscountInput).grandTotal;
  if (typeof expectedTotal === "number" && Math.abs(Math.round(expectedTotal * 100) - Math.round(amountDue * 100)) > 1) {
    throw new Error(
      `Bill changed before payment could be finalized. Review the bill and collect ₱${amountDue.toFixed(2)}.`
    );
  }

  const out = await postPosCommand<{ receiptId: string; receiptNumber: string; totalCents: number; replay: boolean }>(
    "checkout",
    storeId,
    {
      sessionId,
      opId,
      billingRevision: billingState.billingRevision,
      expectedTotalCents: Math.round(amountDue * 100),
      payments: payments.map((p) => stripUndefined({
        methodId: p.methodId,
        amount: Math.round(Number(p.amount) * 100) / 100,
        reference: p.reference ?? null,
        intentDocId: p.intentDocId ?? null,
        fromReservationPaymentId: p.fromReservationPaymentId ?? null,
      })),
    },
  );

  if (!out.replay) {
    try {
      await writeActivityLog({
        storeId, sessionId, user, action: 'PAYMENT_COMPLETED', note: 'Payment completed',
        meta: { receiptId: out.receiptId, receiptNumber: out.receiptNumber, paymentTotal: out.totalCents / 100 },
      });
    } catch (logErr) {
      console.error("[ActivityLog] Failed to write payment log for session", sessionId, logErr);
    }
  }
  return out.receiptId;
}

export async function voidSession({
  storeId,
  sessionId,
  reason,
  actor,
  opId = uuidv4(),
}: {
  storeId: string;
  sessionId: string;
  reason: string;
  actor: AppUser;
  opId?: string;
}) {
  // Server command (audit P1): the session void, ticket cancellation, table
  // release and the PIN / loyalty reversal effects are written by the server.
  const safeReason = (reason ?? '').toString().trim();
  const sessionSnap = await getDoc(doc(db, 'stores', storeId, 'sessions', sessionId)).catch(() => null);
  const s = sessionSnap?.exists() ? (sessionSnap.data() as any) : null;
  const out = await postPosCommand<{ replay: boolean }>("void-session", storeId, { sessionId, opId, reason: safeReason });
  if (!out.replay && s) {
    await writeActivityLog({
      storeId, sessionId, user: actor, action: "SESSION_VOIDED", reason: safeReason,
      sessionContext: {
        sessionStatus: 'voided', sessionStartedAt: s.startedAt,
        sessionMode: s.sessionMode ?? undefined,
        customerName: s.customer?.name ?? s.customerName,
        tableNumber: s.tableNumber,
        tableDisplayName: s.tableDisplayName ?? null,
      },
      meta: { sessionLabel: computeSessionLabel(s) }
    }).catch((e) => console.warn("[ActivityLog] void log failed", e));
  }
  // Loyalty reversal now runs from the server outbox; nothing for the caller.
  return { reversedRedemptionIds: [] as string[] };
}

/**
 * True if a bill-line patch could affect the void / free / discount summary
 * flags on the activeSessions projection. Used to skip the recompute round
 * trip for pure qty / price edits.
 */
function patchAffectsAdjustmentFlags(patch: Record<string, any>): boolean {
  for (const key of Object.keys(patch)) {
    if (key === "voidedQty" || key === "freeQty" || key === "discountQty" || key === "discountValue") return true;
    if (key === "lineAdjustments" || key.startsWith("lineAdjustments.")) return true;
  }
  return false;
}

/**
 * Reads every sessionBillLine for the session, recomputes the three summary
 * booleans, and writes them onto the activeSessions/{sessionId} projection.
 * Replaces the per-session sessionBillLines listener the cashier session-list
 * used to fan out across every active session.
 *
 * Call this after any commit that may have changed a line's void / free /
 * discount state. Safe no-op if the session is no longer in activeSessions
 * (already paid / voided).
 */
export async function recomputeSessionAdjustmentFlags(
  storeId: string,
  sessionId: string,
): Promise<void> {
  if (!storeId || !sessionId) return;
  try {
    const linesRef = collection(db, "stores", storeId, "sessions", sessionId, "sessionBillLines");
    const linesSnap = await getDocs(linesRef);

    let hasVoids = false;
    let hasFree = false;
    let hasDiscounts = false;
    linesSnap.forEach((d) => {
      const data = d.data() as any;
      if ((data.voidedQty ?? 0) > 0) hasVoids = true;
      if ((data.freeQty ?? 0) > 0) hasFree = true;
      if ((data.discountQty ?? 0) > 0 || (data.discountValue ?? 0) > 0) hasDiscounts = true;
      const adjs = data.lineAdjustments ?? {};
      for (const adj of Object.values(adjs) as any[]) {
        if (adj?.kind === "discount") hasDiscounts = true;
      }
    });

    const activeRef = doc(db, "stores", storeId, "activeSessions", sessionId);
    await updateDoc(activeRef, { hasVoids, hasFree, hasDiscounts });
  } catch (e: any) {
    // updateDoc throws if the doc no longer exists in activeSessions (session
    // was finalized in the same window). Badges are irrelevant in that case.
    if (e?.code !== "not-found") {
      console.warn("[recomputeSessionAdjustmentFlags] failed:", e);
    }
  }
}

export type GuestCountApprovalResult = {
  clearedVoidQty: number;
  clampedFreeQty: number;
  clampedDiscountQty: number;
  newBillable: number;
};

/**
 * Approve a pending guest-count change. The approved count is the authoritative
 * final billable headcount, so the package line is reconciled to bill exactly
 * `requestedCount` covers: qtyOrdered is set to the count and the (now
 * redundant) package-cover void is cleared, with free/discount clamped to fit.
 *
 * This closes a double-subtraction bug: voiding covers and approving a
 * guest-count change both reduce `qtyOrdered − voidedQty − freeQty`, so without
 * this reconciliation a prior void would stack on top of the new count (e.g.
 * qty 15, void 10 → approve count 5 left voidedQty 10 → billable max(0, 5-10)=0).
 */
export async function approveGuestCountChange({
  storeId,
  sessionId,
  requestedCount,
  actor,
}: {
  storeId: string;
  sessionId: string;
  requestedCount: number;
  actor: AppUser;
}): Promise<GuestCountApprovalResult> {
  const stamp = getActorStamp(actor);
  const count = Math.max(0, Math.floor(Number(requestedCount) || 0));

  const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
  const projectionRef = doc(db, 'stores', storeId, 'activeSessions', sessionId);

  const result = await runTransaction(db, async (tx: Transaction) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists()) throw new Error('Session disappeared during transaction.');
    const sessionData = sessionSnap.data() as any;
    if (sessionData.status === 'closed' || sessionData.status === 'voided' || sessionData.isPaid) {
      throw new Error('This session has already been closed.');
    }

    // Bundles bill a flat unit, so an approved count only changes the headcount
    // (PINs/covers/analytics), never the package line qty. The approved count is
    // NOT capped: `bundleMaxCap` is the headcount the flat price covers, not a
    // seating limit, so guests beyond it are reconciled onto the Extra Pax line
    // by reconcileBundleLines below.
    const isBundle = !!sessionData.packageSnapshot?.isBundle;

    const packageOfferingId: string | undefined = sessionData.packageOfferingId || undefined;
    const pkgLineRef = packageOfferingId
      ? doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', `package_${packageOfferingId}`)
      : null;

    // All reads must precede all writes in a Firestore transaction.
    const pkgSnap = pkgLineRef ? await tx.get(pkgLineRef) : null;
    const projSnap = await tx.get(projectionRef);

    const summary: GuestCountApprovalResult = {
      clearedVoidQty: 0,
      clampedFreeQty: 0,
      clampedDiscountQty: 0,
      newBillable: count,
    };

    if (isBundle && pkgLineRef && pkgSnap?.exists()) {
      // Flat-billed bundle: leave the package line (qty 1) untouched.
      const line = pkgSnap.data() as any;
      summary.newBillable = Math.max(0, (line.qtyOrdered ?? 1) - (line.voidedQty ?? 0) - (line.freeQty ?? 0));
    } else if (pkgLineRef && pkgSnap?.exists()) {
      const line = pkgSnap.data() as any;
      const prevVoid = Math.max(0, line.voidedQty ?? 0);
      const prevFree = Math.max(0, line.freeQty ?? 0);
      const prevDiscount = Math.max(0, line.discountQty ?? 0);

      const newFree = Math.min(prevFree, count);
      const newDiscount = Math.min(prevDiscount, Math.max(0, count - newFree));

      summary.clearedVoidQty = prevVoid;
      summary.clampedFreeQty = prevFree - newFree;
      summary.clampedDiscountQty = prevDiscount - newDiscount;
      summary.newBillable = Math.max(0, count - newFree);

      const reqAt = sessionData.guestCountChange?.requestedAt;
      const linePatch: Record<string, any> = {
        qtyOrdered: count,
        voidedQty: 0,
        freeQty: newFree,
        discountQty: newDiscount,
        qtyLastSyncedApprovedAt: reqAt ? reqAt.toString() : serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: stamp.uid,
        updatedByName: stamp.username,
      };
      if (prevVoid > 0) {
        linePatch.voidReason = deleteField();
        linePatch.voidNote = deleteField();
      }
      if (newDiscount === 0) {
        linePatch.discountType = null;
        linePatch.discountValue = 0;
      }
      tx.update(pkgLineRef, linePatch);
    }

    tx.update(sessionRef, {
      guestCountFinal: count,
      'guestCountChange.status': 'approved',
      'guestCountChange.approvedByUid': stamp.uid,
      'guestCountChange.approvedAt': serverTimestamp(),
      billingRevision: increment(1),
      updatedAt: serverTimestamp(),
    });

    if (projSnap.exists()) {
      tx.update(projectionRef, {
        guestCountFinal: count,
        'guestCountChange.status': 'approved',
        updatedAt: serverTimestamp(),
      });
    }

    return summary;
  });

  // Void/free/discount on the package line may have changed; reconverge badges.
  await recomputeSessionAdjustmentFlags(storeId, sessionId);
  // Keep the bundle's flat line at qty 1 and its Extra Pax line in step with the
  // approved headcount immediately (don't wait for the cashier to open the bill).
  await reconcileBundleLines(storeId, sessionId, actor);
  return result;
}

/**
 * Reconcile a bundle session's bill lines to its current `guestCountFinal`:
 * force the flat package line to qty 1, and upsert/zero the "Extra Pax" overflow
 * line to `max(0, guests - cap)` (only when the bundle has an extra-head price and
 * a positive cap). No-op for non-bundle, closed, or paid sessions. Idempotent —
 * writes only when a value actually differs. Runs in its own transaction so it
 * can be called after any headcount-changing mutation (verify, approve) for
 * immediate, race-free correctness; the cashier-bill self-heal remains a backstop.
 */
export async function reconcileBundleLines(storeId: string, sessionId: string, actor: AppUser) {
  const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
  const stamp = getActorStamp(actor);
  type ExtraChange = { before: number; after: number; itemName: string; ctx: any };
  let extraChange: ExtraChange | null = null;
  await runTransaction(db, async (tx: Transaction) => {
    extraChange = null; // reset on transaction retry
    const sSnap = await tx.get(sessionRef);
    if (!sSnap.exists()) return;
    const s = sSnap.data() as any;
    if (!s.packageSnapshot?.isBundle) return;
    if (s.status === 'closed' || s.status === 'voided' || s.isPaid) return;
    const pkgId = s.packageOfferingId;
    if (!pkgId) return;

    const cap = Number(s.packageSnapshot.bundleMaxCap ?? 0);
    const extraPrice = Number(s.packageSnapshot.bundleExtraHeadPrice ?? 0);
    const guests = Number(s.guestCountFinal ?? 0);
    const desiredExtra = bundleExtraPax(guests, cap);
    const itemName = `Extra Pax — ${s.packageSnapshot.name ?? 'Bundle'}`;
    const ctx = {
      sessionStatus: s.status,
      sessionStartedAt: s.startedAt,
      sessionMode: s.sessionMode,
      customerName: s.customer?.name ?? s.customerName ?? null,
      tableNumber: s.tableNumber ?? null,
      tableDisplayName: s.tableDisplayName ?? null,
    };

    const pkgRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', `package_${pkgId}`);
    const extraRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', `bundleextra_${pkgId}`);
    const [pkgSnap, extraSnap] = await Promise.all([tx.get(pkgRef), tx.get(extraRef)]);

    if (pkgSnap.exists() && (pkgSnap.data() as any).qtyOrdered !== 1) {
      tx.update(pkgRef, { qtyOrdered: 1, updatedAt: serverTimestamp(), updatedByUid: stamp.uid, updatedByName: stamp.username });
    }

    if (extraSnap.exists()) {
      const before = Number((extraSnap.data() as any).qtyOrdered ?? 0);
      if (before !== desiredExtra) {
        tx.update(extraRef, { qtyOrdered: desiredExtra, updatedAt: serverTimestamp(), updatedByUid: stamp.uid, updatedByName: stamp.username });
        extraChange = { before, after: desiredExtra, itemName, ctx };
      }
    } else if (extraPrice > 0 && desiredExtra > 0) {
      tx.set(extraRef, {
        id: `bundleextra_${pkgId}`,
        type: 'addon',
        itemId: `bundleextra_${pkgId}`,
        itemName,
        category: 'Extra Pax',
        unitPrice: extraPrice,
        qtyOrdered: desiredExtra,
        discountType: null,
        discountValue: 0,
        discountQty: 0,
        freeQty: 0,
        voidedQty: 0,
        kitchenLocationId: null,
        kitchenLocationName: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: stamp.uid,
        updatedByName: stamp.username,
      });
      extraChange = { before: 0, after: desiredExtra, itemName, ctx };
    }
  });

  // Audit the overflow change (draft-stage, best-effort). The headcount change
  // itself is already logged by verify/approve; this records the derived effect.
  if (extraChange) {
    const c = extraChange as ExtraChange;
    await writeActivityLog({
      action: 'BUNDLE_EXTRA_PAX_SYNCED',
      storeId,
      sessionId,
      user: actor,
      meta: { itemName: c.itemName, beforeQty: c.before, afterQty: c.after } as any,
      note: `Extra Pax synced ${c.before} → ${c.after}`,
      sessionContext: c.ctx,
    });
  }
}

/**
 * Updates a sessionBillLine document with new values.
 * Uses a transaction to ensure safe updates.
 */
export async function updateSessionBillLine(
  storeId: string,
  sessionId: string,
  lineId: string,
  patch: Partial<SessionBillLine>,
  user: AppUser
) {
  if (!storeId || !sessionId || !lineId) {
    throw new Error('Missing storeId, sessionId, or lineId');
  }

  const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
  const actor = getActorStamp(user);

  const updatePayload = {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.username,
  };

  const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
  const batch = writeBatch(db);
  batch.update(lineRef, updatePayload);
  batch.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
  const affectsFlags = patchAffectsAdjustmentFlags(patch as Record<string, any>);
  if (navigator.onLine) {
    await batch.commit();
    if (affectsFlags) await recomputeSessionAdjustmentFlags(storeId, sessionId);
  } else {
    // Offline: apply locally & sync later; never await the server ack (it never
    // resolves offline) and fire the flag refresh local-first so we don't hang.
    commitLocalFirst(batch, (err) => console.error("[updateSessionBillLine] offline sync failed", err));
    if (affectsFlags) void recomputeSessionAdjustmentFlags(storeId, sessionId).catch(() => {});
  }
}

export async function removeLineAdjustment(
  storeId: string,
  sessionId: string,
  lineId: string,
  adjId: string,
  user: AppUser
) {
  if (!storeId || !sessionId || !lineId || !adjId) {
    throw new Error("Missing required IDs to remove line adjustment.");
  }

  const lineRef = doc(db, 'stores', storeId, 'sessions', sessionId, 'sessionBillLines', lineId);
  const actor = getActorStamp(user);

  const updatePayload = {
    [`lineAdjustments.${adjId}`]: deleteField(),
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid,
    updatedByName: actor.username,
  };

  const sessionRef = doc(db, 'stores', storeId, 'sessions', sessionId);
  const batch = writeBatch(db);
  batch.update(lineRef, updatePayload);
  batch.update(sessionRef, { billingRevision: increment(1), updatedAt: serverTimestamp() });
  if (navigator.onLine) {
    await batch.commit();
    await recomputeSessionAdjustmentFlags(storeId, sessionId);
  } else {
    commitLocalFirst(batch, (err) => console.error("[removeLineAdjustment] offline sync failed", err));
    void recomputeSessionAdjustmentFlags(storeId, sessionId).catch(() => {});
  }
}


/**
 * Helper to create kitchen tickets for addon/refill items.
 * Can be used within a transaction or standalone.
 */
export async function createKitchenTickets(
  db: Firestore,
  storeId: string,
  sessionId: string,
  session: PendingSession,
  type: OrderItemType,
  line: { itemId: string; itemName: string; kitchenLocationId: string | null; kitchenLocationName?: string | null; billLineId: string | null },
  qty: number,
  actor: ActorStamp,
  opts: { tx: Transaction } | { batch: WriteBatch },
  notes?: string,
  extra?: Record<string, any>
): Promise<Record<string, any> | null> {
  const ticketsColRef = collection(db, `stores/${storeId}/sessions/${sessionId}/kitchentickets`);
  const now = Date.now();
  const serverTs = serverTimestamp();

  const stationId = line.kitchenLocationId;

  // No kitchen station ⇒ this item is exempt from KDS tickets (the caller still
  // bills it). Skip creating any ticket so a location-less item can't break the
  // order / KDS projection.
  if (!stationId) return null;

  const writer = selectTicketWriter(opts);

  // ONE ticket per line item using qtyOrdered for batch-serve flow
  const ticketRef = doc(ticketsColRef);
  const ticketPayload = stripUndefined({
    ...(extra || {}),
    id: ticketRef.id,
    type: type,
    itemId: line.itemId,
    itemName: line.itemName,
    billLineId: line.billLineId,
    qty: qty,
    qtyOrdered: qty,
    qtyServed: 0,
    qtyCancelled: 0,
    qtyRemaining: qty,
    serveLog: [],
    kitchenLocationId: line.kitchenLocationId,
    kitchenLocationName: line.kitchenLocationName,
    notes: notes || null,
    status: "preparing",
    createdByUid: actor.uid,
    createdAt: serverTs,
    createdAtClientMs: now,
    updatedAt: serverTs,
    sessionId: sessionId,
    storeId,
    tableNumber: session.tableNumber,
    tableDisplayName: session.tableDisplayName,
    customerName: session.customer?.name || session.customerName,
    sessionMode: session.sessionMode,
    sessionLabel: computeSessionLabel(session),
    guestCount: session.guestCountFinal || session.guestCountCashierInitial,
  });

  writer.set(ticketRef, ticketPayload);

  if (stationId) {
    const rtKdsDocRef = doc(db, "stores", storeId, "rtKdsTickets", stationId);
    writer.set(rtKdsDocRef, { meta: { source: 'createKitchenTickets', updatedAt: serverTimestamp() }, kitchenLocationId: stationId }, { merge: true });
    writer.update(rtKdsDocRef, {
      [`tickets.${ticketRef.id}`]: ticketPayload,
      activeIds: arrayUnion(ticketRef.id),
      [`sessionIndex.${sessionId}`]: arrayUnion(ticketRef.id),
    });
  }

  return ticketPayload;
}

// ---------------------------------------------------------------------------
// createRefundReceipt
// Creates a refund receipt referencing the original via parentReceiptId.
//
// Runs in a transaction that re-reads the ORIGINAL receipt, so the refundable
// quantities and amounts are checked against its live state (two terminals or
// a double-click cannot refund the same unit twice). The money is valued by
// quoteRefund from what was actually paid (discounts, modifiers, charges, tax
// shared out in integer centavos) and split back to the original tenders; the
// refund receipt carries a negative analytics.mop so drawer/method totals drop.
//
// `requestId` is the idempotency key: the dialog generates one per open, and a
// retry with the same key returns the already-created refund untouched.
// ---------------------------------------------------------------------------
export async function createRefundReceipt(
  storeId: string,
  parentReceipt: Receipt,
  refundQtys: Record<string, number>,
  actor: AppUser,
  reason: string,
  requestId: string = uuidv4(),
): Promise<string> {
  // Server command (audit P1). Same quoteRefund math, idempotent on requestId;
  // analytics and loyalty reversal run from the server outbox.
  void actor;
  const parentReceiptId = parentReceipt.receiptId ?? parentReceipt.id;
  const out = await postPosCommand<{ refundId: string }>("refund", storeId, {
    parentReceiptId,
    requestId,
    refundQtys,
    reason,
  });
  return out.refundId;
}
