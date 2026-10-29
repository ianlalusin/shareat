/**
 * Checkout-time checks for gateway (PayMongo QR Ph) tenders — audit B03.
 *
 * Before this, completePaymentFromUnits trusted any tender row the client sent:
 * a typed or reused PayMongo reference could settle a receipt. Now every
 * gateway tender must point at the server-written bridge doc
 * (stores/{storeId}/paymentIntents/{intentDocId}) that the PayMongo webhook
 * marked paid, for THIS session, for exactly this amount. Clients cannot write
 * bridge docs (firestore.rules), and a receipt's id is its session id, so one
 * paid QR cannot settle two sessions or two tenders.
 *
 * Gateway rows pre-seeded from a reservation deposit have no bridge (the
 * reservation recorded a manual reference); those are checked against the
 * session's reservation doc instead.
 *
 * Pure (no Firestore import) so it is unit-testable; callers do the reads.
 */
import type { ModeOfPayment, Payment } from "@/lib/types";

/** A tender row as sent to checkout. `intentDocId` is set on PayMongo QR rows. */
export type CheckoutPayment = Payment & { intentDocId?: string | null };

export type GatewayCheck =
  | { kind: "bridge"; payment: CheckoutPayment; intentDocId: string }
  | { kind: "reservation"; payment: CheckoutPayment; reservationPaymentId: string };

const toCents = (n: unknown) => Math.round(Number(n) * 100);

function isSafeDocId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/")
    && id !== "." && id !== ".." && !/^__.*__$/.test(id);
}

function isGatewayMethod(m: ModeOfPayment | undefined): boolean {
  return (m as any)?.gateway === "paymongo_qrph";
}

/**
 * Validates every tender's amount and lists the gateway tenders that need a
 * server-side read. Throws on a bad amount, a gateway row with neither a
 * bridge nor a reservation link, or the same bridge used twice.
 */
export function planGatewayChecks(payments: CheckoutPayment[], paymentMethods: ModeOfPayment[]): GatewayCheck[] {
  const checks: GatewayCheck[] = [];
  const seenIntents = new Set<string>();
  for (const p of payments) {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Invalid payment: every tender amount must be a positive number.");
    }
    const method = paymentMethods.find((m) => m.id === p.methodId);
    if (!isGatewayMethod(method)) continue;
    if (p.intentDocId != null && p.intentDocId !== "") {
      if (!isSafeDocId(p.intentDocId)) throw new Error("Invalid scan-to-pay tender.");
      if (seenIntents.has(p.intentDocId)) {
        throw new Error("The same scan-to-pay payment is listed twice. Remove the duplicate.");
      }
      seenIntents.add(p.intentDocId);
      checks.push({ kind: "bridge", payment: p, intentDocId: p.intentDocId });
    } else if (p.fromReservationPaymentId) {
      checks.push({ kind: "reservation", payment: p, reservationPaymentId: p.fromReservationPaymentId });
    } else {
      throw new Error("Scan-to-pay tender isn't linked to a confirmed QR payment. Generate the QR and wait for payment.");
    }
  }
  return checks;
}

/** Returns an error message, or null when the bridge doc proves this tender. */
export function verifyBridgeTender(
  check: Extract<GatewayCheck, { kind: "bridge" }>,
  bridge: Record<string, any> | null | undefined,
  ctx: { storeId: string; sessionId: string },
): string | null {
  const label = "Scan-to-pay payment";
  if (!bridge) return `${label} could not be found. Ask the customer to show their receipt and try again.`;
  if (bridge.status !== "paid") return `${label} is not confirmed paid yet.`;
  if (bridge.storeId != null && bridge.storeId !== ctx.storeId) return `${label} belongs to another store.`;
  if (bridge.sessionId !== ctx.sessionId) return `${label} belongs to another bill.`;
  if (bridge.methodId != null && bridge.methodId !== check.payment.methodId) return `${label} was made with a different payment method.`;
  const bridgeCents = bridge.amountCentavos != null ? Math.round(Number(bridge.amountCentavos)) : toCents(bridge.amount);
  if (bridgeCents !== toCents(check.payment.amount)) return `${label} amount does not match the tender.`;
  const expectedRef = bridge.paymongoPaymentId ?? bridge.paymongoIntentId;
  if (!expectedRef || String(check.payment.reference ?? "") !== String(expectedRef)) {
    return `${label} reference does not match the confirmed payment.`;
  }
  return null;
}

/** Returns an error message, or null when the reservation doc proves this tender. */
export function verifyReservationTender(
  check: Extract<GatewayCheck, { kind: "reservation" }>,
  reservation: Record<string, any> | null | undefined,
  ctx: { sessionId: string },
): string | null {
  const label = "Reservation deposit";
  if (!reservation) return `${label} could not be found for this session.`;
  const applied = reservation.paymentsAppliedToSessionId;
  if (applied && applied !== ctx.sessionId) return `${label} was already applied to another bill.`;
  const rp = (Array.isArray(reservation.payments) ? reservation.payments : [])
    .find((x: any) => x?.id === check.reservationPaymentId);
  if (!rp || rp.voidedAt) return `${label} is missing or voided.`;
  if (rp.methodId !== check.payment.methodId) return `${label} method does not match.`;
  if (toCents(rp.amount) !== toCents(check.payment.amount)) return `${label} amount does not match.`;
  if (String(rp.reference ?? "") !== String(check.payment.reference ?? "")) return `${label} reference does not match.`;
  return null;
}
