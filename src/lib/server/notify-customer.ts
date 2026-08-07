/**
 * Customer-facing notifications for online-order status changes.
 *
 * Ported from the `shareat-website` project's functions/index.js, which already
 * sends the order-placed email/SMS through Resend + Semaphore. This module is
 * the POS-side twin: it fires when *staff* advance an order, so the customer
 * stops having to sit on a polling browser tab to learn anything.
 *
 * Deliberate constraints, all of which are load-bearing:
 *
 *   - Plain global `fetch`, no SDKs, no new npm dependency (Node 20+).
 *   - Nothing here may reject. A bounced email is not a failed transition.
 *   - Missing API keys degrade to "log and skip". A store whose Secret Manager
 *     entries have not been created yet must still be able to accept orders.
 */

/** The only statuses a customer is told about. */
export const NOTIFIABLE_STATUSES = [
  "accepted",
  "ready_for_pickup",
  "out_for_delivery",
  "cancelled",
  "rejected",
] as const;

export type NotifiableStatus = (typeof NOTIFIABLE_STATUSES)[number];

/**
 * SMS defaults to the three "your food is happening" moments.
 *
 * `cancelled` / `rejected` are email-only unless a store opts in: bad news is
 * better delivered with room to explain, and each segment is real money.
 */
export const DEFAULT_SMS_STATUSES = "accepted,ready_for_pickup,out_for_delivery";

/**
 * One GSM-7 SMS segment. Exceeding this bills a *second* segment per recipient,
 * at roughly PHP 0.56 each, on every order, invisibly. Hence the hard cap.
 */
export const SMS_MAX_CHARS = 160;

/**
 * Cap on how long a transition response will wait for the providers. Staff are
 * standing at a POS screen; a slow SMS gateway must not stall the UI.
 */
const NOTIFY_TIMEOUT_MS = 2000;

const DEFAULT_EMAIL_FROM = "SharEat <orders@shareat.net>";

export function isNotifiableStatus(status: string): status is NotifiableStatus {
  return (NOTIFIABLE_STATUSES as readonly string[]).includes(status);
}

// --- formatting ----------------------------------------------------------

/**
 * Manual thousands grouping rather than toLocaleString("en-PH").
 *
 * The rendered string is asserted against a hard 160-char budget, so it must not
 * shift with the host's ICU build — a runtime that formats 12345.67 as
 * "12.345,67" would be a silent correctness change, not a cosmetic one.
 */
function groupedAmount(n: unknown): string {
  const value = Number(n || 0);
  const safe = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(safe).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${safe < 0 ? "-" : ""}${grouped}.${cents}`;
}

/** Email keeps the real peso sign. */
export function peso(n: unknown): string {
  return `₱${groupedAmount(n)}`;
}

/** SMS variant: ASCII "P", and a trailing ".00" dropped to save characters. */
export function pesoShort(n: unknown): string {
  const s = groupedAmount(n);
  return `P${s.endsWith(".00") ? s.slice(0, -3) : s}`;
}

/**
 * Forces a string into printable ASCII.
 *
 * This is a billing control, not a style preference. A single non-GSM-7
 * character — the peso sign, a curly quote lifted from a staff-typed cancel
 * reason, an accented branch name — silently switches the *entire* message to
 * UCS-2, where one segment is 70 characters instead of 160. A 107-character
 * message containing "₱" therefore costs two segments. Stripping to ASCII makes
 * the 160 budget below the real budget.
 */
export function toGsmSafe(value: unknown): string {
  let out = String(value == null ? "" : value)
    .replace(/₱/g, "P") // ₱
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/[‘’]/g, "'") // curly single quotes
    .replace(/[–—]/g, "-") // en/em dash
    .replace(/…/g, "..."); // ellipsis
  out = out.normalize("NFD").replace(/[̀-ͯ]/g, ""); // é -> e
  return out.replace(/[^\x20-\x7E]/g, "");
}

/** Trims to `max`, preferring the last word boundary so words are not sliced. */
export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * A short human-quotable handle for the order.
 *
 * Firestore ids are long and opaque; the last 6 alphanumerics are enough for
 * staff to find the order when a customer calls the branch.
 */
export function shortRef(orderId: unknown): string {
  const cleaned = String(orderId || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return cleaned.slice(-6) || "ORDER";
}

// --- message context -----------------------------------------------------

export type StatusNotifyContext = {
  orderId: string;
  status: NotifiableStatus;
  storeName?: string | null;
  customerName?: string | null;
  email?: string | null;
  phone?: string | null;
  grandTotal?: number | null;
  fulfillmentType?: string | null;
  address?: string | null;
  /** Staff-entered reason. Only present (and only used) for cancelled/rejected. */
  reason?: string | null;
  receiptNumber?: string | null;
};

export type NotifyOutcome = {
  emailAt: number | null;
  emailError: string | null;
  smsAt: number | null;
  smsError: string | null;
};

// --- SMS bodies ----------------------------------------------------------

/**
 * Content rule, enforced by test: none of these may tell the customer to reply.
 *
 * Resend cannot receive mail and an alphanumeric Semaphore sender id cannot
 * receive SMS at all, so "reply with your reference number" asks the customer
 * for something they physically cannot do. Where a message needs an action, it
 * points at the branch instead.
 */
export function buildStatusSms(ctx: StatusNotifyContext): string {
  const store = toGsmSafe(ctx.storeName || "").trim();
  // Store docs are named "SharEat Lipa", not "Lipa", so a blind "SharEat "
  // prefix renders "SharEat SharEat Lipa". Brand once, and only once.
  const prefix = !store ? "SharEat" : /^shareat\b/i.test(store) ? store : `SharEat ${store}`;
  const ref = shortRef(ctx.orderId);
  const amount = pesoShort(ctx.grandTotal);

  let head: string;
  let reasonClause = "";

  switch (ctx.status) {
    case "accepted":
      head = `${prefix}: Order ${ref} confirmed, ${amount}. We are preparing it now.`;
      break;
    case "ready_for_pickup":
      head = `${prefix}: Order ${ref} is ready for pickup. Please collect it at the branch. Total ${amount}.`;
      break;
    case "out_for_delivery":
      head = `${prefix}: Order ${ref} is on the way. Total ${amount}. Please watch out for our rider.`;
      break;
    case "cancelled":
      head = `${prefix}: Order ${ref} was cancelled. Please contact the branch if you need help.`;
      reasonClause = " Reason:";
      break;
    case "rejected":
      head = `${prefix}: Order ${ref} could not be accepted. Please contact the branch if you need help.`;
      reasonClause = " Reason:";
      break;
  }

  head = toGsmSafe(head).replace(/\s+/g, " ").trim();

  // The reason is appended only if a meaningful amount of it survives the
  // budget. Dangling " Reason:" with nothing after it reads as a bug to the
  // customer, so it is all-or-nothing.
  const reason = toGsmSafe(ctx.reason || "").replace(/\s+/g, " ").trim();
  if (reasonClause && reason) {
    const room = SMS_MAX_CHARS - head.length - reasonClause.length - 1;
    if (room >= 8) {
      const fitted = truncateAtWord(reason, room);
      if (fitted) head = `${head}${reasonClause} ${fitted}`;
    }
  }

  if (head.length <= SMS_MAX_CHARS) return head;
  console.warn(
    `[notify-customer] SMS body is ${head.length} chars for order ${ctx.orderId} (${ctx.status}); truncating to ${SMS_MAX_CHARS} to stay within one segment.`
  );
  return truncateAtWord(head, SMS_MAX_CHARS);
}

// --- email bodies --------------------------------------------------------

export function buildStatusEmail(ctx: StatusNotifyContext): { subject: string; text: string } {
  const store = String(ctx.storeName || "SharEat").trim() || "SharEat";
  const name = String(ctx.customerName || "").trim() || "there";
  const ref = shortRef(ctx.orderId);
  const total = peso(ctx.grandTotal);
  const isDelivery = ctx.fulfillmentType === "delivery";
  const address = String(ctx.address || "").trim();
  const reason = String(ctx.reason || "").trim();

  const out: string[] = [];
  let subject: string;

  switch (ctx.status) {
    case "accepted":
      subject = `SharEat order ${ref} - confirmed!`;
      out.push(`Hi ${name}, salamat sa order!`);
      out.push("");
      out.push(`Your order at ${store} is confirmed and we are preparing it now.`);
      break;

    case "ready_for_pickup":
      subject = `SharEat order ${ref} - ready for pickup`;
      out.push(`Hi ${name}, your order is ready!`);
      out.push("");
      out.push(`Order ${ref} is packed and waiting for you at ${store}.`);
      out.push("Please show this order number at the counter when you collect it.");
      break;

    case "out_for_delivery":
      subject = `SharEat order ${ref} - on the way`;
      out.push(`Hi ${name}, your order is on the way!`);
      out.push("");
      out.push(`Order ${ref} has left ${store} with our rider.`);
      if (address) out.push(`Delivering to: ${address}`);
      out.push("Please keep your phone nearby so the rider can find you.");
      break;

    case "cancelled":
      subject = `SharEat order ${ref} - cancelled`;
      out.push(`Hi ${name},`);
      out.push("");
      out.push(`We are sorry — your order at ${store} has been cancelled.`);
      if (reason) out.push(`Reason: ${reason}`);
      break;

    case "rejected":
      subject = `SharEat order ${ref} - could not be accepted`;
      out.push(`Hi ${name},`);
      out.push("");
      out.push(`We are sorry — ${store} could not accept your order this time.`);
      if (reason) out.push(`Reason: ${reason}`);
      break;
  }

  out.push("");
  out.push(`Order number: ${ref}`);
  if (ctx.receiptNumber) out.push(`Receipt: ${ctx.receiptNumber}`);
  out.push(isDelivery ? "Fulfillment: Delivery" : "Fulfillment: Pickup");
  out.push(`Order total: ${total}`);

  out.push("");
  if (ctx.status === "cancelled" || ctx.status === "rejected") {
    // No refund promise here: whether money moved is a payment-package concern
    // and this module never reads or computes a money field.
    out.push(`If you have any questions, please call or visit ${store} and quote order ${ref}.`);
  } else {
    out.push(`Need help with this order? Please call or visit ${store} and quote order ${ref}.`);
  }
  out.push("");
  out.push("Salamat po!");
  out.push("SharEat");

  return { subject, text: out.join("\n") };
}

// --- config --------------------------------------------------------------

type Env = Record<string, string | undefined>;

/**
 * SMS stays OFF unless explicitly armed. Only a literal "true" (trimmed,
 * case-insensitive) counts — "yes", "1", "on" do not, because a typo that
 * silently starts spending money is worse than a typo that silently does not.
 */
export function notifySmsEnabled(env: Env = process.env): boolean {
  return String(env.NOTIFY_SMS_ENABLED ?? "false").trim().toLowerCase() === "true";
}

/** The comma-separated allow-list that acts as the per-status cost dial. */
export function smsStatuses(env: Env = process.env): string[] {
  const raw = String(env.NOTIFY_SMS_STATUSES ?? "").trim() || DEFAULT_SMS_STATUSES;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function smsAllowedForStatus(status: string, env: Env = process.env): boolean {
  return smsStatuses(env).includes(String(status).trim().toLowerCase());
}

function semaphoreSenderName(env: Env): string {
  return String(env.SEMAPHORE_SENDER_NAME || "").trim() || "SEMAPHORE";
}

// --- transports ----------------------------------------------------------

export type EmailSender = (to: string, subject: string, text: string) => Promise<void>;
export type SmsSender = (phoneE164: string, message: string) => Promise<void>;

/**
 * Thrown when a provider key is absent. Callers treat this as "log and skip"
 * rather than as an outage — see `notifyOrderStatusChange`.
 */
const SKIP_PREFIX = "skipped:";

export const sendTransactionalEmail: EmailSender = async (to, subject, text) => {
  const env = process.env;
  const key = String(env.RESEND_API_KEY || "").trim();
  // Never throw at module load and never block a transition: an unconfigured
  // store degrades to a logged skip.
  if (!key) throw new Error(`${SKIP_PREFIX} RESEND_API_KEY is not configured`);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: String(env.NOTIFY_EMAIL_FROM || "").trim() || DEFAULT_EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status}: ${t.slice(0, 160)}`);
  }
};

export const sendTransactionalSms: SmsSender = async (phoneE164, message) => {
  const env = process.env;
  const key = String(env.SEMAPHORE_API_KEY || "").trim();
  if (!key) throw new Error(`${SKIP_PREFIX} SEMAPHORE_API_KEY is not configured`);

  const params = new URLSearchParams({
    apikey: key,
    number: String(phoneE164).replace("+", ""),
    message,
    sendername: semaphoreSenderName(env),
  });
  const resp = await fetch("https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Semaphore ${resp.status}: ${t.slice(0, 160)}`);
  }
};

// --- orchestration -------------------------------------------------------

/** Structural subset of a Firestore DocumentReference, so tests can pass a fake. */
export type MergeWritableRef = {
  set(data: Record<string, unknown>, options: { merge: true }): Promise<unknown>;
};

export type NotifyDeps = {
  sendEmail?: EmailSender;
  sendSms?: SmsSender;
  env?: Env;
  now?: () => number;
  logger?: Pick<Console, "log" | "warn" | "error">;
  timeoutMs?: number;
};

/**
 * Sends both channels for one status change and records the outcome.
 *
 * NOTHING in here may reject. The status write has already committed by the time
 * this runs; a notification failure must not fail the transition, roll it back,
 * or disturb receipt minting / the analytics delta.
 *
 * Returns null when the status is not one the customer is told about.
 */
export async function notifyOrderStatusChange(
  orderRef: MergeWritableRef | null,
  ctx: StatusNotifyContext,
  deps: NotifyDeps = {}
): Promise<NotifyOutcome | null> {
  if (!isNotifiableStatus(ctx.status)) return null;

  const env = deps.env ?? process.env;
  const log = deps.logger ?? console;
  const now = deps.now ?? Date.now;
  const sendEmail = deps.sendEmail ?? sendTransactionalEmail;
  const sendSms = deps.sendSms ?? sendTransactionalSms;
  const timeoutMs = deps.timeoutMs ?? NOTIFY_TIMEOUT_MS;

  const outcome: NotifyOutcome = { emailAt: null, emailError: null, smsAt: null, smsError: null };

  const note = (e: unknown) => String((e as any)?.message ?? e).slice(0, 300);
  const report = (channel: string, message: string) => {
    if (message.startsWith(SKIP_PREFIX)) {
      log.warn(`[notify-customer] ${channel} ${message} (order ${ctx.orderId} -> ${ctx.status})`);
    } else {
      log.error(`[notify-customer] ${channel} failed for order ${ctx.orderId} -> ${ctx.status}: ${message}`);
    }
  };

  const emailJob = (async () => {
    const to = String(ctx.email || "").trim();
    if (!to) {
      outcome.emailError = `${SKIP_PREFIX} no email address on order`;
      return;
    }
    try {
      const { subject, text } = buildStatusEmail(ctx);
      await sendEmail(to, subject, text);
      outcome.emailAt = now();
    } catch (e) {
      outcome.emailError = note(e);
      report("email", outcome.emailError);
    }
  })();

  const smsJob = (async () => {
    const to = String(ctx.phone || "").trim();
    if (!to) {
      outcome.smsError = `${SKIP_PREFIX} no phone number on order`;
      return;
    }
    try {
      const body = buildStatusSms(ctx);

      if (!smsAllowedForStatus(ctx.status, env)) {
        outcome.smsError = `${SKIP_PREFIX} ${ctx.status} is not in NOTIFY_SMS_STATUSES`;
        log.log(
          `[notify-customer] SMS not allowed for ${ctx.status} — would send to ${to} (${body.length} chars): ${body}`
        );
        return;
      }
      if (!notifySmsEnabled(env)) {
        outcome.smsError = `${SKIP_PREFIX} NOTIFY_SMS_ENABLED is not true`;
        log.log(
          `[notify-customer] SMS disabled — would send to ${to} (${body.length} chars): ${body}`
        );
        return;
      }

      await sendSms(to, body);
      outcome.smsAt = now();
    } catch (e) {
      outcome.smsError = note(e);
      report("SMS", outcome.smsError);
    }
  })();

  // Cap the wait so a slow provider cannot hold up the staff-facing response.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const capped = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const raced = await Promise.race([
    Promise.allSettled([emailJob, smsJob]).then(() => "settled"),
    capped,
  ]);
  if (timer) clearTimeout(timer);

  if (raced === "timeout") {
    const late = `still pending after ${timeoutMs}ms; the send may yet succeed`;
    if (!outcome.emailAt && !outcome.emailError) outcome.emailError = late;
    if (!outcome.smsAt && !outcome.smsError) outcome.smsError = late;
    log.warn(
      `[notify-customer] notifications for order ${ctx.orderId} exceeded ${timeoutMs}ms; responding anyway.`
    );
  }

  // Follow-up merge write. Only `notifications` is touched, and only the
  // per-status leaf inside it — `notifications.orderPlaced` is owned by the
  // website project's checkout function and must survive untouched.
  if (orderRef) {
    try {
      await orderRef.set(
        { notifications: { statusChanges: { [ctx.status]: outcome } } },
        { merge: true }
      );
    } catch (e) {
      log.error(`[notify-customer] could not record outcome on order ${ctx.orderId}: ${note(e)}`);
    }
  }

  return outcome;
}
