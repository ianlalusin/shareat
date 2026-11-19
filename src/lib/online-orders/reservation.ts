/**
 * Pure helpers for website set reservations (kind "set_reservation").
 * Payments are recorded by hand by staff; recording enough of them (>= 50%)
 * confirms the order. No Firestore here so everything is unit-testable.
 */

export type ReservationPayment = {
  amount: number;
  methodLabel: string;
  reference: string | null;
  proofUrl: string | null;
  atMs: number;
  byUid: string;
  byName: string;
};

export const DEPOSIT_RATIO = 0.5;
export const DEPOSIT_METHODS = ["GCash", "Maya", "Bank transfer"] as const;

const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: number) => Math.round(n * 100);
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function paidAmount(payments: ReservationPayment[]): number {
  return round2((payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
}

export function balanceOf(grandTotal: number, payments: ReservationPayment[]): number {
  return Math.max(0, round2(grandTotal - paidAmount(payments)));
}

export function meetsDeposit(grandTotal: number, payments: ReservationPayment[]): boolean {
  // Compare in centavos: paid >= half of total, so an odd-centavo total rounds against the customer's favour only by < 1 centavo.
  return cents(paidAmount(payments)) * 2 >= cents(grandTotal);
}

type PaymentInput = { amount: unknown; methodLabel: unknown; reference?: unknown; proofUrl?: unknown };

export function validatePayment(
  input: PaymentInput,
  grandTotal: number,
  payments: ReservationPayment[],
):
  | { ok: true; value: Omit<ReservationPayment, "atMs" | "byUid" | "byName"> }
  | { ok: false; error: string } {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  const balance = balanceOf(grandTotal, payments);
  if (cents(amount) > cents(balance)) return { ok: false, error: `Amount exceeds the balance (${peso(balance)}).` };

  const methodLabel = String(input.methodLabel ?? "");
  if (!(DEPOSIT_METHODS as readonly string[]).includes(methodLabel)) {
    return { ok: false, error: "Choose GCash, Maya or Bank transfer." };
  }
  const reference = String(input.reference ?? "").trim().slice(0, 80) || null;
  const rawProof = String(input.proofUrl ?? "").trim();
  const proofUrl = rawProof.startsWith("https://") && rawProof.length <= 1500 ? rawProof : null;
  if (!reference && !proofUrl) return { ok: false, error: "Add a reference number or a screenshot." };

  return { ok: true, value: { amount: round2(amount), methodLabel, reference, proofUrl } };
}

export function isReleaseDue(
  order: { kind?: string; status?: string; kitchenReleasedAtMs?: number | null; releaseAtMs?: number },
  nowMs: number,
): boolean {
  return (
    order.kind === "set_reservation" &&
    order.status === "accepted" &&
    !order.kitchenReleasedAtMs &&
    typeof order.releaseAtMs === "number" &&
    order.releaseAtMs <= nowMs
  );
}

export function receiptMop(
  order: { grandTotal: number; payments?: ReservationPayment[] },
  completionLabel: string,
): Record<string, number> {
  const mop: Record<string, number> = {};
  for (const p of order.payments || []) mop[p.methodLabel] = round2((mop[p.methodLabel] || 0) + p.amount);
  const rest = balanceOf(order.grandTotal, order.payments || []);
  if (rest > 0) mop[completionLabel] = round2((mop[completionLabel] || 0) + rest);
  return mop;
}

/** Payment line for an inbox row: reservations are paid by phone, not "on delivery". */
export function reservationRowPaymentText(order: { status?: string; grandTotal: number; payments?: ReservationPayment[] }): string {
  // A completed order had its balance collected at hand-over, so it is paid in full.
  if (order.status === "completed") return "Paid in full";
  const payments = order.payments || [];
  const paid = paidAmount(payments);
  if (paid === 0) return "Payment arranged by phone";
  if (balanceOf(order.grandTotal, payments) === 0) return "Paid in full";
  return `Received ${peso(paid)} of ${peso(order.grandTotal)}`;
}

type BadgeOrder = {
  status?: string;
  grandTotal: number;
  payments?: ReservationPayment[];
  releaseAtMs?: number;
};

export function reservationBadge(
  order: BadgeOrder,
  nowMs: number,
): { label: string; tone: "red" | "amber" | "green" | "gray" } {
  if (order.status === "completed") return { label: "Paid in full", tone: "green" };
  const payments = order.payments || [];
  const paid = paidAmount(payments);
  if (paid > 0 && balanceOf(order.grandTotal, payments) === 0) return { label: "Paid", tone: "green" };
  // A pending order past its release time is silently not cooked, so it is red whatever was paid.
  const due = order.status === "pending" && typeof order.releaseAtMs === "number" && order.releaseAtMs < nowMs;
  if (paid === 0) return due ? { label: "Unpaid, due", tone: "red" } : { label: "Unpaid", tone: "gray" };
  if (!meetsDeposit(order.grandTotal, payments)) {
    return due ? { label: "Deposit below 50%, due", tone: "red" } : { label: "Deposit below 50%", tone: "amber" };
  }
  return { label: `Partial ${peso(paid)} of ${peso(order.grandTotal)}`, tone: "amber" };
}
