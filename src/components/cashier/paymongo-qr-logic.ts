// Pure helpers for PaymongoQrView (audit F06/F07). No React / Firebase here.

export const QR_CREATE_TIMEOUT_MS = 20_000;
export const QR_STATUS_TIMEOUT_MS = 15_000;

export type QrIntentStatus = "awaiting_payment" | "paid" | "failed" | "expired" | "canceled";

export type StatusCheckResult =
  | { ok: true; status: QrIntentStatus | string }
  | { ok: false; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Asks the server to re-check the intent with PayMongo. Non-2xx responses and
 * network errors come back as `ok: false` with a message staff can act on —
 * they never read as "not paid".
 */
export async function checkQrStatus(
  fetchFn: FetchLike,
  body: { storeId: string; sessionId: string; intentDocId: string },
  token: string | null | undefined,
  timeoutMs = QR_STATUS_TIMEOUT_MS,
): Promise<StatusCheckResult> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetchFn("/api/pos/paymongo/status", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const data = (await res.json().catch(() => null)) as { status?: unknown; error?: unknown } | null;
    if (!res.ok) {
      const reason = typeof data?.error === "string" ? data.error : res.status === 502 ? "PayMongo did not answer" : "server error";
      return { ok: false, message: `Status check failed (${res.status}: ${reason}). Payment status is unknown — check again.` };
    }
    if (!data || typeof data.status !== "string") {
      return { ok: false, message: "Status check returned an unreadable answer. Payment status is unknown — check again." };
    }
    return { ok: true, status: data.status };
  } catch (e) {
    const aborted = (e as { name?: string })?.name === "AbortError";
    return {
      ok: false,
      message: aborted
        ? "Status check timed out. Payment status is unknown — check again."
        : "Could not reach the server to check payment. Payment status is unknown — check again.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** What the expired screen may say, given the authoritative check result. */
export type ExpiryVerdict =
  | { kind: "paid" }          // server says paid — wait for the bridge doc listener
  | { kind: "not_paid" }      // server confirms nothing was paid
  | { kind: "unknown"; message: string };

export function expiryVerdict(result: StatusCheckResult | null): ExpiryVerdict {
  if (!result) return { kind: "unknown", message: "Checking with PayMongo…" };
  if (!result.ok) return { kind: "unknown", message: result.message };
  if (result.status === "paid") return { kind: "paid" };
  if (["awaiting_payment", "expired", "failed", "canceled"].includes(result.status)) return { kind: "not_paid" };
  return { kind: "unknown", message: `Unexpected status "${result.status}". Check again.` };
}

/** Server-minus-device clock offset from a response Date header (0 when unusable). */
export function serverClockOffsetMs(dateHeader: string | null | undefined, localNowMs: number): number {
  if (!dateHeader) return 0;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return 0;
  const offset = serverMs - localNowMs;
  // Date headers have 1s resolution; ignore sub-2s noise.
  return Math.abs(offset) < 2000 ? 0 : offset;
}

/**
 * Whether the bridge-doc listener must be subscribed. It stays on for every
 * unresolved intent — including after the on-screen countdown ends — so a late
 * paid webhook is still accepted.
 */
export function shouldListenForPayment(intentDocId: string | null, paidSeen: boolean): boolean {
  return !!intentDocId && !paidSeen;
}
