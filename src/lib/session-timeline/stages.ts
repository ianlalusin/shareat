import type { ActivityLog, KitchenTicket, SessionBillLine } from "@/lib/types";
import type { DailySessionRow } from "@/lib/analytics/session-row";
import { toJsDate } from "@/lib/utils/date";
import { bundleExtraPax } from "@/lib/billing/bundle";
import { isServeLate, isServeVeryLate } from "@/lib/kitchen/sla";
import { describeActivityLog } from "@/lib/logs/describe-log";
import type { SessionTrailSources } from "./types";

/**
 * Turns one session's raw documents into the ordered stages the expanded row
 * renders: start → verification → service → adjustments → bill out → close.
 *
 * Pure and synchronous, so the shape of a session's history is testable without
 * Firestore. Stages come out in that fixed narrative order, never sorted by
 * time — a late-arriving log must not reorder the story.
 *
 * Two rules worth keeping in mind while reading:
 *   - Lapses that are already on disk (`verifyDurationMs`, `ticket.durationMs`,
 *     `row.durationMs`) are reused, never recomputed. They were measured at the
 *     moment they happened; recomputing from timestamps drifts.
 *   - The bill-out stage is scoped to THIS ROW's receipt. One session can
 *     produce several (a void-and-re-ring, a refund), and each row is one
 *     receipt.
 */

export type StageKind = "start" | "verify" | "service" | "adjustments" | "billout" | "closed";
export type StageTone = "neutral" | "warn" | "danger";

export type StageFact = {
  label: string;
  value: string;
  tone?: StageTone;
  hint?: string;
};

export type StageItem = {
  id: string;
  name: string;
  kind: "refill" | "addon";
  qtyLabel: string;
  orderedAtMs: number | null;
  servedAtMs: number | null;
  lapseMs: number | null;
  tone: StageTone;
  free: boolean;
  priceLabel: string | null;
  flavors: string[];
  batches: { qty: number; atMs: number | null }[];
  servedBy: string | null;
};

export type StageAdjustment = {
  id: string;
  atMs: number;
  kind: "void" | "free" | "discount" | "charge" | "override" | "change" | "other";
  title: string;
  detail?: string;
  amount: number | null;
  actorUid: string | null;
  actorName: string | null;
  /** Set when this came from an activity log, so a deep link can highlight it. */
  logId: string | null;
};

export type SessionStage = {
  kind: StageKind;
  label: string;
  atMs: number | null;
  /** Time since the previous meaningful moment, where one is known. */
  lapseMs?: number | null;
  facts: StageFact[];
  items?: StageItem[];
  adjustments?: StageAdjustment[];
  /** Compact one-liner under the stage title (serve summary, MOP list…). */
  summary?: string;
  actors: string[];
  tone: StageTone;
  /** True when the stage is rendered but has nothing in it. */
  empty: boolean;
};

const ADJUSTMENT_ACTIONS = new Set<ActivityLog["action"]>([
  "VOID_TICKETS", "UNVOID", "SESSION_VOIDED", "RECEIPT_VOIDED", "RECEIPT_REFUND", "RECEIPT_DELETED",
  "MARK_FREE", "UNMARK_FREE",
  "DISCOUNT_APPLIED", "DISCOUNT_EDITED", "DISCOUNT_REMOVED",
  "BILL_DISCOUNT_APPLIED", "BILL_DISCOUNT_REMOVED",
  "CUSTOM_CHARGE_ADDED", "CUSTOM_CHARGE_REMOVED",
  "PRICE_OVERRIDE", "edit_line",
  "PACKAGE_QTY_OVERRIDE_SET", "PACKAGE_QTY_RESYNC_APPROVED_CHANGE",
  "RECEIPT_EDITED",
  "GUEST_COUNT_REQUESTED", "GUEST_COUNT_APPROVED", "GUEST_COUNT_REJECTED",
  "PACKAGE_CHANGE_REQUESTED", "PACKAGE_CHANGE_APPROVED", "PACKAGE_CHANGE_REJECTED",
]);

function adjustmentKind(action: string): StageAdjustment["kind"] {
  if (action.includes("VOID") || action === "RECEIPT_REFUND" || action === "RECEIPT_DELETED") return "void";
  if (action.includes("FREE")) return "free";
  if (action.includes("DISCOUNT")) return "discount";
  if (action.includes("CHARGE")) return "charge";
  if (action === "PRICE_OVERRIDE" || action === "edit_line" || action.startsWith("PACKAGE_QTY")) return "override";
  if (action.startsWith("GUEST_COUNT_") || action.startsWith("PACKAGE_CHANGE_")) return "change";
  return "other";
}

/** Epoch ms from whichever of several shapes actually carries a time. */
export function ms(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const d = toJsDate(v);
    if (d) return d.getTime();
  }
  return null;
}

const peso = (n: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pushFact(facts: StageFact[], label: string, value: unknown, extra?: Partial<StageFact>) {
  if (value === null || value === undefined || value === "") return;
  facts.push({ label, value: String(value), ...extra });
}

// --- Service ----------------------------------------------------------------

/**
 * Refills and add-ons, with the order → serve lapse each already carries.
 *
 * Discriminating on `ticket.type` matters: `billLineId` is null on refills
 * *and* on the package ticket, so it cannot tell them apart. It is only used to
 * decide whether an item was free.
 */
export function buildServiceItems(
  tickets: KitchenTicket[],
  billLines: SessionBillLine[],
  flavorNames: Map<string, string>
): StageItem[] {
  const lineById = new Map(billLines.map((l) => [l.id, l]));

  return tickets
    .filter((t) => {
      const type = (t as any).type;
      if (type !== "refill" && type !== "addon") return false;
      // Cancelled tickets are an adjustment, not a service event.
      return !((t as any).status === "cancelled" || (t as any).cancelledAt);
    })
    .map((t) => {
      const anyT = t as any;
      const kind: StageItem["kind"] = anyT.type === "refill" ? "refill" : "addon";
      const orderedAtMs = ms(anyT.createdAtClientMs, anyT.createdAt);
      const servedAtMs = ms(anyT.servedAtClientMs, anyT.servedAt);

      // Persisted at serve time by the KDS; only recompute for tickets that
      // predate that field.
      const lapseMs =
        typeof anyT.durationMs === "number" && Number.isFinite(anyT.durationMs)
          ? anyT.durationMs
          : orderedAtMs != null && servedAtMs != null && servedAtMs >= orderedAtMs
            ? servedAtMs - orderedAtMs
            : null;

      const ordered = num(anyT.qtyOrdered ?? anyT.qty ?? 1);
      const served = anyT.qtyServed != null ? num(anyT.qtyServed) : null;
      const qtyLabel =
        served != null && served > 0 && served < ordered ? `${served}/${ordered}` : `${ordered || 1}`;

      const line = anyT.billLineId ? lineById.get(anyT.billLineId) : undefined;
      const unitPrice = line ? num((line as any).unitPrice) : 0;
      // Refills are comped by design — every refill is written with a null
      // billLineId, so no line means nothing was charged.
      const free = kind === "refill" || !line || unitPrice === 0;

      const flavors: string[] = Array.isArray(anyT.initialFlavorIds)
        ? anyT.initialFlavorIds.map((id: string) => flavorNames.get(id) ?? id)
        : [];

      const batches = Array.isArray(anyT.serveLog)
        ? anyT.serveLog.map((e: any) => ({
            // `qty`, not `qtyServed` — the batch-serve writer emits `qty`.
            qty: num(e?.qty),
            atMs: ms(e?.servedAtClientMs, e?.servedAt),
          }))
        : [];

      return {
        id: t.id,
        name: anyT.itemName ?? "Item",
        kind,
        qtyLabel,
        orderedAtMs,
        servedAtMs,
        lapseMs,
        tone: isServeVeryLate(lapseMs) ? "danger" : isServeLate(lapseMs) ? "warn" : "neutral",
        free,
        priceLabel: free || !line ? null : peso(unitPrice * (ordered || 1)),
        flavors,
        batches,
        servedBy: anyT.servedByProfileName ?? null,
      } as StageItem;
    })
    .sort((a, b) => (a.orderedAtMs ?? 0) - (b.orderedAtMs ?? 0));
}

// --- Adjustments ------------------------------------------------------------

/**
 * Everything that changed the bill after it was first rung up, from three
 * sources merged and de-duplicated.
 *
 * `lineAdjustments` is the interesting one: those entries carry their own
 * timestamp and actor and are invisible in every existing session view. They are
 * matched against activity logs — same line, same value, within a couple of
 * seconds — and the log wins when both exist, because it also carries the actor
 * role and the reason. Unmatched entries still render, which is what surfaces an
 * offline adjustment whose log never landed.
 */
export function collectAdjustments(
  logs: ActivityLog[],
  billLines: SessionBillLine[],
  tickets: KitchenTicket[]
): StageAdjustment[] {
  const out: StageAdjustment[] = [];

  for (const log of logs) {
    if (!ADJUSTMENT_ACTIONS.has(log.action)) continue;
    const atMs = ms(log.createdAt);
    if (atMs == null) continue;
    const d = describeActivityLog(log);
    out.push({
      id: `log:${log.id}`,
      atMs,
      kind: adjustmentKind(log.action),
      title: d.title,
      detail: d.detail,
      amount: d.amount ?? null,
      actorUid: log.actorUid ?? null,
      actorName: log.serverProfileName ?? log.actorName ?? null,
      logId: log.id,
    });
  }

  const DEDUPE_WINDOW_MS = 2000;
  const matchesExistingLog = (atMs: number, value: number) =>
    out.some((a) => a.logId && Math.abs(a.atMs - atMs) <= DEDUPE_WINDOW_MS &&
      (a.amount == null || Math.abs(Math.abs(a.amount) - Math.abs(value)) < 0.01));

  for (const line of billLines) {
    const adjustments = (line as any).lineAdjustments ?? {};
    for (const [adjId, raw] of Object.entries(adjustments) as [string, any][]) {
      const atMs = ms(raw?.createdAtClientMs, raw?.createdAt);
      if (atMs == null) continue;
      const value = num(raw?.value);
      if (matchesExistingLog(atMs, value)) continue;
      const isPercent = raw?.type === "percent";
      const qty = num(raw?.qty) || 1;
      out.push({
        id: `adj:${line.id}:${adjId}`,
        atMs,
        kind: raw?.kind === "charge" ? "charge" : "discount",
        title: `${raw?.kind === "charge" ? "Charge" : "Discount"} on ${(line as any).itemName ?? "item"}`,
        detail: [isPercent ? `${value}%` : peso(value), qty > 1 ? `×${qty}` : null, raw?.note]
          .filter(Boolean).join(" · ") || undefined,
        amount: isPercent ? null : value * qty,
        actorUid: raw?.createdByUid ?? null,
        actorName: raw?.createdByName ?? null,
        logId: null,
      });
    }
  }

  for (const t of tickets) {
    const anyT = t as any;
    if (anyT.status !== "cancelled" && !anyT.cancelledAt) continue;
    const atMs = ms(anyT.cancelledAtClientMs, anyT.cancelledAt);
    if (atMs == null) continue;
    // A TICKET_CANCELLED log for the same ticket already covers this.
    const dupe = out.some((a) => a.logId && a.kind === "void" && Math.abs(a.atMs - atMs) <= DEDUPE_WINDOW_MS);
    if (dupe) continue;
    out.push({
      id: `cancel:${t.id}`,
      atMs,
      kind: "void",
      title: `${anyT.itemName ?? "Kitchen ticket"} cancelled in kitchen`,
      detail: anyT.cancelReason ?? undefined,
      amount: null,
      actorUid: anyT.cancelledByUid ?? null,
      actorName: null,
      logId: null,
    });
  }

  return out.sort((a, b) => a.atMs - b.atMs);
}

// --- Stage assembly ---------------------------------------------------------

function formatLapse(msValue: number | null | undefined): string | null {
  if (typeof msValue !== "number" || !Number.isFinite(msValue) || msValue < 0) return null;
  const s = Math.round(msValue / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Extra-pax note for a bundle session, if one applies. Re-exported for the UI. */
export function bundleOverflowNote(session: any): string | null {
  const snap = session?.packageSnapshot;
  if (!snap?.isBundle) return null;
  const cap = num(snap.bundleMaxCap);
  const guests = num(session?.guestCountFinal);
  const extra = bundleExtraPax(guests, cap);
  if (!extra) return null;
  const price = num(snap.bundleExtraHeadPrice);
  return price > 0
    ? `${extra} beyond the ${cap} covered @ ${peso(price)} each`
    : `${extra} beyond the ${cap} covered — no extra charge`;
}

export function buildSessionStages(input: {
  row: DailySessionRow;
  sources: SessionTrailSources;
  flavorNames?: Map<string, string>;
  /** Other rows of the same session — used to say "this session had 2 receipts". */
  siblingRows?: DailySessionRow[];
}): SessionStage[] {
  const { row, sources } = input;
  const flavorNames = input.flavorNames ?? new Map<string, string>();
  const session = (sources.session ?? null) as any;
  const receipt = (sources.receipt ?? null) as any;
  const analytics = receipt?.analytics ?? {};
  const isAlaCarte = (session?.sessionMode ?? row.sessionMode) === "alacarte";

  const stages: SessionStage[] = [];

  // --- 1. Start -------------------------------------------------------------
  {
    const facts: StageFact[] = [];
    const startedAtMs = ms(session?.startedAtClientMs, session?.startedAt) ?? row.startedAtMs;

    pushFact(facts, "Mode", isAlaCarte ? "Ala carte" : "Dine-in");
    pushFact(facts, "Table", session?.tableDisplayName ?? session?.tableNumber ?? row.tableNumber);
    pushFact(facts, "Customer", session?.customer?.name ?? session?.customerName ?? row.customerName);

    if (!isAlaCarte) {
      pushFact(facts, "Package", session?.packageSnapshot?.name ?? row.packageName ?? analytics?.guestCountSnapshot?.packageName);
      pushFact(facts, "Pax (cashier)", session?.guestCountCashierInitial ?? row.pax);
    } else if (session?.guestCountFinal ?? session?.guestCountCashierInitial) {
      // Ala carte headcount is never billed, so labelling matters — an unlabelled
      // number here reads as covers.
      pushFact(facts, "Party size", session.guestCountFinal ?? session.guestCountCashierInitial, {
        hint: "Not billed — ala carte bills per item",
      });
    }

    const flavors: string[] = Array.isArray(session?.initialFlavorIds)
      ? session.initialFlavorIds.map((id: string) => flavorNames.get(id) ?? id)
      : [];
    if (flavors.length) pushFact(facts, "Flavors", flavors.join(", "));

    if (!session) {
      facts.push({ label: "Note", value: "Session record not linked to this receipt", tone: "warn" });
    }

    stages.push({
      kind: "start",
      label: "Session start",
      atMs: startedAtMs,
      facts,
      actors: [],
      tone: "neutral",
      empty: false,
    });
  }

  // --- 2. Verification ------------------------------------------------------
  // Ala carte is never verified, so the stage would be permanently empty.
  if (!isAlaCarte && session) {
    const verifiedAtMs = ms(session.verifiedAt);
    const facts: StageFact[] = [];

    // Measured at verify time — see the note at the top about reusing lapses.
    const verifyLapse =
      typeof session.verifyDurationMs === "number"
        ? session.verifyDurationMs
        : (() => {
            const log = sources.activityLogs.find((l) => l.action === "SESSION_VERIFIED");
            const fromLog = (log?.meta as any)?.verifyDurationMs;
            if (typeof fromLog === "number") return fromLog;
            const startedAtMs = ms(session.startedAtClientMs, session.startedAt);
            return verifiedAtMs != null && startedAtMs != null ? verifiedAtMs - startedAtMs : null;
          })();

    const initial = session.guestCountCashierInitial ?? null;
    const final = session.guestCountFinal ?? null;

    if (verifiedAtMs != null) {
      pushFact(facts, "Pax", initial != null && final != null && initial !== final ? `${initial} → ${final}` : final ?? initial);
      pushFact(facts, "Server count", session.guestCountServerVerified);
      pushFact(facts, "Verified by", session.verifiedByServerProfileName);
    }

    const gc = session.guestCountChange;
    if (gc?.requestedAt) {
      const decided = gc.approvedAt ? "approved" : gc.rejectedAt ? "rejected" : "pending";
      pushFact(facts, "Guest count change", `→ ${gc.requestedCount ?? "?"} (${decided})`, {
        tone: decided === "rejected" ? "warn" : "neutral",
      });
    }

    const neverVerified = verifiedAtMs == null;
    stages.push({
      kind: "verify",
      label: "Verification",
      atMs: verifiedAtMs,
      lapseMs: verifyLapse,
      facts: neverVerified
        ? [{ label: "Status", value: "Never verified by a server", tone: "warn" }]
        : facts,
      summary: neverVerified ? undefined : formatLapse(verifyLapse) ? `${formatLapse(verifyLapse)} after seating` : undefined,
      actors: session.verifiedByServerProfileName ? [session.verifiedByServerProfileName] : [],
      tone: neverVerified ? "warn" : "neutral",
      empty: neverVerified,
    });
  }

  // --- 3. Refills & add-ons -------------------------------------------------
  {
    const items = buildServiceItems(sources.tickets, sources.billLines, flavorNames);
    const served = items.filter((i) => i.servedAtMs != null);
    const lapses = served.map((i) => i.lapseMs).filter((v): v is number => typeof v === "number");
    const avg = lapses.length ? lapses.reduce((a, b) => a + b, 0) / lapses.length : null;
    const late = items.filter((i) => i.tone !== "neutral").length;

    const summary = items.length
      ? [
          `${served.length}/${items.length} served`,
          avg != null ? `avg ${formatLapse(avg)}` : null,
          late ? `${late} late` : null,
        ].filter(Boolean).join(" · ")
      : undefined;

    const shouldRender = items.length > 0 || !isAlaCarte;
    if (shouldRender) {
      const refills = items.filter((i) => i.kind === "refill").length;
      const addons = items.length - refills;
      const facts: StageFact[] = [];
      pushFact(facts, "Refills", refills || null);
      pushFact(facts, "Add-ons", addons || null);

      stages.push({
        kind: "service",
        label: "Refills & add-ons",
        atMs: items[0]?.orderedAtMs ?? null,
        facts,
        items,
        summary,
        actors: Array.from(new Set(items.map((i) => i.servedBy).filter((n): n is string => !!n))),
        tone: late ? "warn" : "neutral",
        empty: items.length === 0,
      });
    }
  }

  // --- 4. Adjustments -------------------------------------------------------
  // The one stage that disappears entirely when there is nothing to say: a clean
  // session should look clean.
  {
    const adjustments = collectAdjustments(sources.activityLogs, sources.billLines, sources.tickets);
    if (adjustments.length > 0) {
      const voids = adjustments.filter((a) => a.kind === "void").length;
      const facts: StageFact[] = [];
      pushFact(facts, "Total", `${adjustments.length}`);
      pushFact(facts, "Voids", voids || null, { tone: voids ? "warn" : undefined });

      stages.push({
        kind: "adjustments",
        label: "Adjustments",
        atMs: adjustments[0].atMs,
        facts,
        adjustments,
        actors: Array.from(new Set(adjustments.map((a) => a.actorName).filter((n): n is string => !!n))),
        tone: voids ? "warn" : "neutral",
        empty: false,
      });
    }
  }

  // --- 5. Bill out ----------------------------------------------------------
  {
    const facts: StageFact[] = [];
    const atMs = ms(receipt?.createdAtClientMs, receipt?.createdAt) ?? row.closedAtMs;

    const subtotal = analytics.subtotal;
    const discounts = analytics.discountsTotal ?? receipt?.discountsTotal ?? row.totalDiscount;
    const charges = analytics.chargesTotal ?? row.chargesTotal;
    const tax = analytics.taxAmount;
    const total = receipt?.total ?? analytics.grandTotal ?? row.total;

    if (subtotal != null) pushFact(facts, "Subtotal", peso(num(subtotal)));
    if (discounts) pushFact(facts, "Discounts", `− ${peso(num(discounts))}`, { tone: "warn" });
    if (charges) pushFact(facts, "Charges", `+ ${peso(num(charges))}`);
    if (tax != null && num(tax) !== 0) pushFact(facts, "VAT", peso(num(tax)));
    pushFact(facts, "Total", peso(num(total)));
    if (receipt?.totalPaid != null) pushFact(facts, "Paid", peso(num(receipt.totalPaid)));
    if (receipt?.change) pushFact(facts, "Change", peso(num(receipt.change)));
    pushFact(facts, "Receipt", row.receiptNumber ?? receipt?.receiptNumber);
    pushFact(facts, "Cashier", receipt?.createdByUsername);

    const mop = (analytics.mop ?? {}) as Record<string, number>;
    const mopSummary = Object.entries(mop)
      .filter(([, v]) => num(v) !== 0)
      .map(([k, v]) => `${k} ${peso(num(v))}`)
      .join(" · ");

    if (receipt?.isEdited) {
      facts.push({
        label: "Edited",
        value: `v${receipt.editVersion ?? 1}`,
        tone: "warn",
        hint: receipt.editReason ?? undefined,
      });
    }

    // A bundle covers its first N guests flat; anything past that is either an
    // Extra Pax line or an explicit freebie. Say which, so a total that looks
    // low for the headcount explains itself.
    const overflow = bundleOverflowNote(session);
    if (overflow) facts.push({ label: "Extra pax", value: overflow });

    const snapshot = analytics.guestCountSnapshot;
    if (snapshot && !snapshot.isBundle && num(snapshot.discrepancy) !== 0) {
      facts.push({
        label: "Cover check",
        value: `Billed ${snapshot.billedPackageCovers} for ${snapshot.finalGuestCount} guests`,
        tone: "warn",
      });
    }

    const isRefund = !!row.isRefund || !!receipt?.isRefund;
    if (isRefund) {
      const parent = input.siblingRows?.find((r) => r.receiptId === receipt?.parentReceiptId);
      facts.push({
        label: "Refund of",
        value: parent?.receiptNumber ?? receipt?.parentReceiptId ?? "original receipt",
        tone: "danger",
      });
    }

    stages.push({
      kind: "billout",
      label: isRefund ? "Refund" : "Bill out",
      atMs,
      facts,
      summary: mopSummary ? (isRefund ? `Refunded via ${mopSummary}` : mopSummary) : undefined,
      actors: receipt?.createdByUsername ? [receipt.createdByUsername] : [],
      tone: isRefund ? "danger" : "neutral",
      empty: !receipt,
    });
  }

  // --- 6. Closed ------------------------------------------------------------
  {
    const closedAtMs = ms(session?.closedAtClientMs, session?.closedAt) ?? row.closedAtMs;
    const receiptAtMs = ms(receipt?.createdAtClientMs, receipt?.createdAt);
    const facts: StageFact[] = [];

    // Already clamped to a sane maximum when the projection row was built.
    if (row.durationMs) pushFact(facts, "Total session", formatLapse(row.durationMs));
    pushFact(facts, "Closed by", session?.closedByUsername ?? receipt?.createdByUsername);

    // Close and payment happen in one transaction; repeating the same clock
    // twice reads as two separate events.
    const sameMoment = closedAtMs != null && receiptAtMs != null && Math.abs(closedAtMs - receiptAtMs) < 5000;

    stages.push({
      kind: "closed",
      label: "Session closed",
      atMs: closedAtMs,
      facts,
      summary: sameMoment ? "Closed at payment" : undefined,
      actors: [],
      tone: "neutral",
      empty: false,
    });
  }

  return stages;
}
