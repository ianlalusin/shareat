import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NOTIFIABLE_STATUSES,
  SMS_MAX_CHARS,
  buildStatusEmail,
  buildStatusSms,
  isNotifiableStatus,
  notifyOrderStatusChange,
  notifySmsEnabled,
  peso,
  sendTransactionalEmail,
  sendTransactionalSms,
  smsAllowedForStatus,
  toGsmSafe,
  type NotifiableStatus,
  type StatusNotifyContext,
} from "@/lib/server/notify-customer";

/**
 * A realistic worst case on purpose: a 40-character branch name and a five-digit
 * total are the two inputs most likely to blow the 160-char SMS budget.
 */
const LONG_BRANCH = "Lipa City Big Ben Mall Ground Floor Unit"; // 40 chars

const BASE: StatusNotifyContext = {
  orderId: "Xk8Qz2mNpR7bV4tL9wYc",
  status: "accepted",
  storeName: LONG_BRANCH,
  customerName: "Maria Dela Cruz",
  email: "maria@example.com",
  phone: "+639171234567",
  grandTotal: 12345.67,
  fulfillmentType: "pickup",
  address: null,
  reason: null,
};

function ctxFor(status: NotifiableStatus, over: Partial<StatusNotifyContext> = {}): StatusNotifyContext {
  const needsReason = status === "cancelled" || status === "rejected";
  return {
    ...BASE,
    status,
    fulfillmentType: status === "out_for_delivery" ? "delivery" : BASE.fulfillmentType,
    address: status === "out_for_delivery" ? "123 P. Burgos St, Lipa City, Batangas" : null,
    reason: needsReason ? "Kitchen is closing early due to a power interruption." : null,
    ...over,
  };
}

/** Minimal stand-in for a Firestore DocumentReference with merge semantics. */
function fakeRef(initial: Record<string, any> = {}) {
  const doc: Record<string, any> = structuredClone(initial);
  const calls: Array<{ data: Record<string, unknown>; options: { merge: true } }> = [];
  const deepMerge = (target: Record<string, any>, patch: Record<string, any>) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if (!target[k] || typeof target[k] !== "object") target[k] = {};
        deepMerge(target[k], v);
      } else {
        target[k] = v;
      }
    }
  };
  return {
    doc,
    calls,
    set: vi.fn(async (data: Record<string, unknown>, options: { merge: true }) => {
      calls.push({ data, options });
      deepMerge(doc, data as Record<string, any>);
    }),
  };
}

const silentLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  silentLogger.log.mockClear();
  silentLogger.warn.mockClear();
  silentLogger.error.mockClear();
});

// --- (a) length + ASCII ---------------------------------------------------

describe("SMS rendering budget", () => {
  it("renders all five statuses under the one-segment cap with a long branch and a 5-digit total", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const body = buildStatusSms(ctxFor(status));
      expect(body.length, `${status} body: ${body}`).toBeLessThanOrEqual(SMS_MAX_CHARS);
      expect(body.length, `${status} must not be empty`).toBeGreaterThan(0);
    }
  });

  it("renders all five statuses as pure printable ASCII", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const body = buildStatusSms(ctxFor(status));
      expect(body, `${status} body: ${body}`).toMatch(/^[\x20-\x7E]*$/);
      // eslint-disable-next-line no-control-regex
      expect(/[^\x00-\x7F]/.test(body), `${status} contains a non-ASCII char`).toBe(false);
    }
  });

  it("stays within the cap even when every input is hostile", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const body = buildStatusSms(
        ctxFor(status, {
          storeName: "Ñ".repeat(80),
          customerName: "A".repeat(120),
          grandTotal: 9876543.21,
          reason: "power interruption ".repeat(30),
          orderId: "z".repeat(200),
        })
      );
      expect(body.length, `${status} body: ${body}`).toBeLessThanOrEqual(SMS_MAX_CHARS);
      expect(body).toMatch(/^[\x20-\x7E]*$/);
    }
  });

  it("brands exactly once when the store name already starts with SharEat", () => {
    // Store docs in shareat-hub-v2 are named "SharEat Lipa", not "Lipa".
    const body = buildStatusSms(ctxFor("accepted", { storeName: "SharEat Lipa" }));
    expect(body).toContain("SharEat Lipa:");
    expect(body).not.toContain("SharEat SharEat");
    expect((body.match(/SharEat/g) || []).length).toBe(1);
  });

  it("still brands a store name that does not carry the brand", () => {
    const body = buildStatusSms(ctxFor("accepted", { storeName: "Lipa" }));
    expect(body).toContain("SharEat Lipa:");
  });

  it("falls back to the bare brand when the store name is unknown", () => {
    const body = buildStatusSms(ctxFor("accepted", { storeName: null }));
    expect(body.startsWith("SharEat: Order")).toBe(true);
  });

  it("truncates a long reason at a word boundary rather than mid-word", () => {
    const body = buildStatusSms(
      ctxFor("cancelled", {
        storeName: "Lipa",
        reason: "supplier delivery delayed indefinitely because of severe weather warnings today",
      })
    );
    expect(body.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    // Nothing may dangle: a trailing "Reason:" with no reason reads as a bug.
    expect(body.trimEnd()).not.toMatch(/Reason:$/);
  });

  it("omits the reason clause entirely when there is no room for a meaningful one", () => {
    const body = buildStatusSms(
      ctxFor("rejected", { storeName: "Q".repeat(60), reason: "kitchen closed early tonight" })
    );
    expect(body.length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    expect(body.trimEnd()).not.toMatch(/Reason:$/);
  });
});

// --- (b) the peso sign never reaches an SMS -------------------------------

describe("non-GSM-7 characters never reach an SMS body", () => {
  it("strips a peso sign injected through any free-text input", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const body = buildStatusSms(
        ctxFor(status, {
          storeName: `Lipa ₱ Branch`,
          customerName: "José ₱ Ñoño",
          reason: "customer paid ₱500 short — see “notes”",
        })
      );
      expect(body, `${status} leaked ₱`).not.toContain("₱");
      expect(body).not.toMatch(/[“”‘’–—…]/);
      expect(body).toMatch(/^[\x20-\x7E]*$/);
    }
  });

  it("formats the SMS total with an ASCII P and the email total with a real peso sign", () => {
    const sms = buildStatusSms(ctxFor("accepted"));
    expect(sms).toContain("P12,345.67");
    expect(sms).not.toContain("₱");

    const email = buildStatusEmail(ctxFor("accepted"));
    expect(email.text).toContain("₱12,345.67");
  });

  it("toGsmSafe normalises quotes, dashes, ellipses and accents", () => {
    expect(toGsmSafe("“smart” ‘quotes’ – dash — em … é ñ ₱")).toBe('"smart" \'quotes\' - dash - em ... e n P');
  });

  it("peso() groups thousands deterministically, independent of host ICU", () => {
    expect(peso(12345.67)).toBe("₱12,345.67");
    expect(peso(1000000)).toBe("₱1,000,000.00");
    expect(peso(0)).toBe("₱0.00");
  });
});

// --- (c) never ask the customer to reply ----------------------------------

describe("content rule: never tell the customer to reply", () => {
  it("no SMS body contains the word 'reply' in any casing", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const body = buildStatusSms(ctxFor(status));
      expect(body.toLowerCase(), `${status} body: ${body}`).not.toContain("reply");
    }
  });

  it("no email subject or body contains the word 'reply' in any casing", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const { subject, text } = buildStatusEmail(ctxFor(status));
      expect(subject.toLowerCase(), `${status} subject`).not.toContain("reply");
      expect(text.toLowerCase(), `${status} body`).not.toContain("reply");
    }
  });

  it("no message suggests any other unreachable inbound channel", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const sms = buildStatusSms(ctxFor(status)).toLowerCase();
      const { text } = buildStatusEmail(ctxFor(status));
      for (const banned of ["reply", "respond to this", "text us back", "answer this message"]) {
        expect(sms, `${status} sms`).not.toContain(banned);
        expect(text.toLowerCase(), `${status} email`).not.toContain(banned);
      }
    }
  });
});

// --- (d) NOTIFY_SMS_ENABLED gating ----------------------------------------

async function runNotify(
  over: Partial<StatusNotifyContext>,
  env: Record<string, string | undefined>,
  refInitial: Record<string, any> = {}
) {
  const sendEmail = vi.fn(async () => {});
  const sendSms = vi.fn(async () => {});
  const ref = fakeRef(refInitial);
  const status = (over.status ?? "accepted") as NotifiableStatus;
  const outcome = await notifyOrderStatusChange(ref, ctxFor(status, over), {
    sendEmail,
    sendSms,
    env,
    now: () => 1_700_000_000_000,
    logger: silentLogger,
  });
  return { sendEmail, sendSms, ref, outcome };
}

describe("NOTIFY_SMS_ENABLED gating", () => {
  const OFF = [undefined, "false", "FALSE", "0", "", "yes", "1", "on", "True!", " "];

  for (const value of OFF) {
    it(`sends zero SMS when NOTIFY_SMS_ENABLED is ${JSON.stringify(value)}`, async () => {
      const { sendEmail, sendSms, outcome } = await runNotify(
        { status: "accepted" },
        { NOTIFY_SMS_ENABLED: value }
      );
      expect(sendSms).toHaveBeenCalledTimes(0);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(outcome?.emailAt).toBe(1_700_000_000_000);
      expect(outcome?.smsAt).toBeNull();
      expect(outcome?.smsError).toContain("NOTIFY_SMS_ENABLED is not true");
    });
  }

  const ON = ["true", "TRUE", " true ", "True", "\ttrue\n"];

  for (const value of ON) {
    it(`sends exactly one SMS when NOTIFY_SMS_ENABLED is ${JSON.stringify(value)}`, async () => {
      const { sendEmail, sendSms, outcome } = await runNotify(
        { status: "accepted" },
        { NOTIFY_SMS_ENABLED: value }
      );
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(outcome?.smsAt).toBe(1_700_000_000_000);
      expect(outcome?.smsError).toBeNull();
    });
  }

  it("email is unaffected by the SMS flag in every case", async () => {
    for (const value of [...OFF, ...ON]) {
      const { sendEmail } = await runNotify({ status: "accepted" }, { NOTIFY_SMS_ENABLED: value });
      expect(sendEmail, `flag=${JSON.stringify(value)}`).toHaveBeenCalledTimes(1);
    }
  });

  it("notifySmsEnabled reads the flag literally", () => {
    expect(notifySmsEnabled({ NOTIFY_SMS_ENABLED: "true" })).toBe(true);
    expect(notifySmsEnabled({ NOTIFY_SMS_ENABLED: "TRUE" })).toBe(true);
    expect(notifySmsEnabled({ NOTIFY_SMS_ENABLED: " true " })).toBe(true);
    expect(notifySmsEnabled({})).toBe(false);
    expect(notifySmsEnabled({ NOTIFY_SMS_ENABLED: "1" })).toBe(false);
    expect(notifySmsEnabled({ NOTIFY_SMS_ENABLED: "yes" })).toBe(false);
  });
});

// --- (e) NOTIFY_SMS_STATUSES filtering ------------------------------------

describe("NOTIFY_SMS_STATUSES filtering", () => {
  const ARMED = { NOTIFY_SMS_ENABLED: "true" }; // no explicit list -> default list

  it("sends SMS for the three default statuses", async () => {
    for (const status of ["accepted", "ready_for_pickup", "out_for_delivery"] as NotifiableStatus[]) {
      const { sendEmail, sendSms } = await runNotify({ status }, ARMED);
      expect(sendSms, `${status} should SMS`).toHaveBeenCalledTimes(1);
      expect(sendEmail).toHaveBeenCalledTimes(1);
    }
  });

  it("cancelled and rejected send email but zero SMS under the default list", async () => {
    for (const status of ["cancelled", "rejected"] as NotifiableStatus[]) {
      const { sendEmail, sendSms, outcome } = await runNotify({ status }, ARMED);
      expect(sendSms, `${status} must not SMS`).toHaveBeenCalledTimes(0);
      expect(sendEmail, `${status} must email`).toHaveBeenCalledTimes(1);
      expect(outcome?.smsError).toContain("not in NOTIFY_SMS_STATUSES");
      expect(outcome?.emailAt).not.toBeNull();
    }
  });

  it("an explicit opt-in list arms cancellations", async () => {
    const { sendSms } = await runNotify(
      { status: "cancelled" },
      { NOTIFY_SMS_ENABLED: "true", NOTIFY_SMS_STATUSES: "accepted,cancelled" }
    );
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("an explicit list narrows as well as widens", async () => {
    const { sendSms } = await runNotify(
      { status: "out_for_delivery" },
      { NOTIFY_SMS_ENABLED: "true", NOTIFY_SMS_STATUSES: "accepted" }
    );
    expect(sendSms).toHaveBeenCalledTimes(0);
  });

  it("tolerates whitespace and casing in the list", () => {
    const env = { NOTIFY_SMS_STATUSES: " Accepted , READY_FOR_PICKUP " };
    expect(smsAllowedForStatus("accepted", env)).toBe(true);
    expect(smsAllowedForStatus("ready_for_pickup", env)).toBe(true);
    expect(smsAllowedForStatus("out_for_delivery", env)).toBe(false);
  });

  it("falls back to the default list when the var is empty", () => {
    expect(smsAllowedForStatus("accepted", { NOTIFY_SMS_STATUSES: "" })).toBe(true);
    expect(smsAllowedForStatus("cancelled", { NOTIFY_SMS_STATUSES: "" })).toBe(false);
  });
});

// --- (4) silent statuses ---------------------------------------------------

describe("statuses the customer is never told about", () => {
  const SILENT = ["preparing", "ready", "completed", "expired", "pending", "pending_payment"];

  it("isNotifiableStatus rejects every silent status", () => {
    for (const status of SILENT) expect(isNotifiableStatus(status), status).toBe(false);
  });

  it("produces zero email and zero SMS calls, and writes nothing", async () => {
    for (const status of SILENT) {
      const sendEmail = vi.fn(async () => {});
      const sendSms = vi.fn(async () => {});
      const ref = fakeRef();
      const outcome = await notifyOrderStatusChange(
        ref,
        { ...BASE, status: status as NotifiableStatus },
        { sendEmail, sendSms, env: { NOTIFY_SMS_ENABLED: "true" }, logger: silentLogger }
      );
      expect(outcome, `${status} must not notify`).toBeNull();
      expect(sendEmail, `${status} email`).toHaveBeenCalledTimes(0);
      expect(sendSms, `${status} sms`).toHaveBeenCalledTimes(0);
      expect(ref.set, `${status} write`).toHaveBeenCalledTimes(0);
    }
  });

  it("notifies for exactly the five in-scope statuses and no others", () => {
    expect([...NOTIFIABLE_STATUSES]).toEqual([
      "accepted",
      "ready_for_pickup",
      "out_for_delivery",
      "cancelled",
      "rejected",
    ]);
  });
});

// --- (f) a failed send cannot break the transition ------------------------

describe("send failures are contained", () => {
  it("a rejecting email sender and a rejecting SMS sender both resolve and are recorded", async () => {
    const sendEmail = vi.fn(async () => {
      throw new Error("Resend 422: domain not verified");
    });
    const sendSms = vi.fn(async () => {
      throw new Error("Semaphore 401: invalid api key");
    });
    const ref = fakeRef();

    const outcome = await notifyOrderStatusChange(ref, ctxFor("accepted"), {
      sendEmail,
      sendSms,
      env: { NOTIFY_SMS_ENABLED: "true" },
      logger: silentLogger,
    });

    expect(outcome).not.toBeNull();
    expect(outcome?.emailAt).toBeNull();
    expect(outcome?.smsAt).toBeNull();
    expect(outcome?.emailError).toContain("domain not verified");
    expect(outcome?.smsError).toContain("invalid api key");
    // Both failures recorded on the order, transition untouched.
    expect(ref.doc.notifications.statusChanges.accepted.emailError).toContain("domain not verified");
    expect(ref.doc.notifications.statusChanges.accepted.smsError).toContain("invalid api key");
  });

  it("never rejects, whatever the transports do", async () => {
    const throwers = [
      () => {
        throw new Error("sync throw");
      },
      async () => {
        throw new Error("async throw");
      },
      async () => {
        throw "not even an Error";
      },
    ];
    for (const t of throwers) {
      await expect(
        notifyOrderStatusChange(fakeRef(), ctxFor("accepted"), {
          sendEmail: t as any,
          sendSms: t as any,
          env: { NOTIFY_SMS_ENABLED: "true" },
          logger: silentLogger,
        })
      ).resolves.toBeTruthy();
    }
  });

  it("a failing follow-up write is swallowed too", async () => {
    const ref = {
      set: vi.fn(async () => {
        throw new Error("PERMISSION_DENIED");
      }),
    };
    await expect(
      notifyOrderStatusChange(ref, ctxFor("accepted"), {
        sendEmail: async () => {},
        sendSms: async () => {},
        env: { NOTIFY_SMS_ENABLED: "true" },
        logger: silentLogger,
      })
    ).resolves.toBeTruthy();
    expect(silentLogger.error).toHaveBeenCalled();
  });

  it("a hanging provider resolves within the timeout instead of blocking", async () => {
    const outcome = await notifyOrderStatusChange(fakeRef(), ctxFor("accepted"), {
      sendEmail: () => new Promise<void>(() => {}), // never settles
      sendSms: async () => {},
      env: { NOTIFY_SMS_ENABLED: "true" },
      logger: silentLogger,
      timeoutMs: 10,
    });
    expect(outcome?.emailAt).toBeNull();
    expect(outcome?.emailError).toContain("still pending");
  });

  it("a missing email address or phone number is a skip, not a failure", async () => {
    const { sendEmail, sendSms, outcome } = await runNotify(
      { status: "accepted", email: null, phone: null },
      { NOTIFY_SMS_ENABLED: "true" }
    );
    expect(sendEmail).toHaveBeenCalledTimes(0);
    expect(sendSms).toHaveBeenCalledTimes(0);
    expect(outcome?.emailError).toContain("no email address");
    expect(outcome?.smsError).toContain("no phone number");
  });
});

// --- (g) the follow-up write is surgical ----------------------------------

describe("the follow-up write touches only notifications", () => {
  it("preserves a pre-existing notifications.orderPlaced value", async () => {
    const orderPlaced = { emailAt: 1_600_000_000_000, emailError: null, smsAt: null, smsError: "nope" };
    const { ref } = await runNotify(
      { status: "accepted" },
      { NOTIFY_SMS_ENABLED: "true" },
      {
        status: "accepted",
        grandTotal: 12345.67,
        contact: { name: "Maria", phone: "+639171234567" },
        notifications: { orderPlaced },
      }
    );

    expect(ref.doc.notifications.orderPlaced).toEqual(orderPlaced);
    expect(ref.doc.notifications.statusChanges.accepted.emailAt).toBe(1_700_000_000_000);
  });

  it("writes exactly one merge update whose only top-level key is `notifications`", async () => {
    const { ref } = await runNotify({ status: "accepted" }, { NOTIFY_SMS_ENABLED: "true" });
    expect(ref.calls).toHaveLength(1);
    expect(Object.keys(ref.calls[0].data)).toEqual(["notifications"]);
    expect(ref.calls[0].options).toEqual({ merge: true });

    const notifications = ref.calls[0].data.notifications as Record<string, unknown>;
    expect(Object.keys(notifications)).toEqual(["statusChanges"]);
    const statusChanges = notifications.statusChanges as Record<string, unknown>;
    expect(Object.keys(statusChanges)).toEqual(["accepted"]);
    expect(Object.keys(statusChanges.accepted as object).sort()).toEqual([
      "emailAt",
      "emailError",
      "smsAt",
      "smsError",
    ]);
  });

  it("leaves every other field on the order untouched", async () => {
    const initial = {
      status: "accepted",
      grandTotal: 12345.67,
      receiptId: "rcpt_1",
      receiptNumber: "SELIP-000123",
      statusHistory: [{ to: "accepted" }],
      payment: { paid: true },
    };
    const { ref } = await runNotify({ status: "accepted" }, { NOTIFY_SMS_ENABLED: "true" }, initial);

    expect(ref.doc.status).toBe("accepted");
    expect(ref.doc.grandTotal).toBe(12345.67);
    expect(ref.doc.receiptId).toBe("rcpt_1");
    expect(ref.doc.receiptNumber).toBe("SELIP-000123");
    expect(ref.doc.statusHistory).toEqual([{ to: "accepted" }]);
    expect(ref.doc.payment).toEqual({ paid: true });
  });

  it("a second status change adds a sibling without clobbering the first", async () => {
    const ref = fakeRef({ notifications: { orderPlaced: { emailAt: 1 } } });
    const deps = {
      sendEmail: async () => {},
      sendSms: async () => {},
      env: { NOTIFY_SMS_ENABLED: "true" },
      now: () => 1_700_000_000_000,
      logger: silentLogger,
    };
    await notifyOrderStatusChange(ref, ctxFor("accepted"), deps);
    await notifyOrderStatusChange(ref, ctxFor("ready_for_pickup"), deps);

    expect(ref.doc.notifications.orderPlaced).toEqual({ emailAt: 1 });
    expect(ref.doc.notifications.statusChanges.accepted.emailAt).toBe(1_700_000_000_000);
    expect(ref.doc.notifications.statusChanges.ready_for_pickup.emailAt).toBe(1_700_000_000_000);
  });
});

// --- (h) missing secrets degrade quietly ----------------------------------

describe("missing provider keys", () => {
  const saved = { resend: process.env.RESEND_API_KEY, semaphore: process.env.SEMAPHORE_API_KEY };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SEMAPHORE_API_KEY;
  });

  afterEach(() => {
    if (saved.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved.resend;
    if (saved.semaphore === undefined) delete process.env.SEMAPHORE_API_KEY;
    else process.env.SEMAPHORE_API_KEY = saved.semaphore;
  });

  it("the default senders reject with a skip marker instead of calling out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(sendTransactionalEmail("a@b.com", "s", "t")).rejects.toThrow(
      /skipped: RESEND_API_KEY is not configured/
    );
    await expect(sendTransactionalSms("+639171234567", "hi")).rejects.toThrow(
      /skipped: SEMAPHORE_API_KEY is not configured/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("notifyOrderStatusChange resolves and records the skip rather than throwing", async () => {
    const ref = fakeRef();
    const outcome = await notifyOrderStatusChange(ref, ctxFor("accepted"), {
      env: { NOTIFY_SMS_ENABLED: "true" },
      logger: silentLogger,
    });
    expect(outcome?.emailAt).toBeNull();
    expect(outcome?.emailError).toContain("RESEND_API_KEY is not configured");
    expect(outcome?.smsError).toContain("SEMAPHORE_API_KEY is not configured");
    expect(ref.doc.notifications.statusChanges.accepted.emailError).toContain("not configured");
  });

  it("importing the module with no configuration present does not throw", async () => {
    vi.resetModules();
    await expect(import("@/lib/server/notify-customer")).resolves.toBeTruthy();
  });
});

// --- copy review fixtures --------------------------------------------------

describe("rendered copy (fixtures for human review)", () => {
  it("every status renders a non-empty subject and body", () => {
    for (const status of NOTIFIABLE_STATUSES) {
      const { subject, text } = buildStatusEmail(ctxFor(status));
      expect(subject.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain("SharEat");
      // The order handle must always be quotable back to the branch.
      expect(text).toMatch(/Order number: [A-Z0-9]+/);
    }
  });

  it("cancelled and rejected emails carry the staff-entered reason", () => {
    for (const status of ["cancelled", "rejected"] as NotifiableStatus[]) {
      const { text } = buildStatusEmail(ctxFor(status, { reason: "power interruption" }));
      expect(text).toContain("Reason: power interruption");
    }
  });

  it("the delivery email includes the delivery address", () => {
    const { text } = buildStatusEmail(ctxFor("out_for_delivery"));
    expect(text).toContain("123 P. Burgos St, Lipa City, Batangas");
    expect(text).toContain("Fulfillment: Delivery");
  });
});
