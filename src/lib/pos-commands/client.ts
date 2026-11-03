"use client";

import { auth } from "@/lib/firebase/client";

/**
 * Browser side of the P1 financial commands (docs/audit/pos-financial-commands.md).
 * Sends the Firebase ID token plus the signed local-profile session token
 * (header x-pos-operator-session) so the server, not the client, decides who
 * the operator is.
 */
export const OPERATOR_HEADER = "x-pos-operator-session";

/** Same storage key useServerProfile writes (read-only use here). */
const profileKey = (storeId: string) => `shareat:serverProfile:${storeId}`;

export function getOperatorSessionToken(storeId: string): string | null {
  try {
    const raw = window.localStorage.getItem(profileKey(storeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.token === "string" && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

export class PosCommandHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string | null) {
    super(message);
    this.name = "PosCommandHttpError";
  }
}

export async function postPosCommand<T = any>(path: string, storeId: string, body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new PosCommandHttpError("You are signed out. Sign in again.", 401, "unauthenticated");
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const op = getOperatorSessionToken(storeId);
  if (op) headers[OPERATOR_HEADER] = op;
  const res = await fetch(`/api/pos/commands/${path}`, { method: "POST", headers, body: JSON.stringify({ storeId, ...body }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new PosCommandHttpError(json?.error || `Request failed (${res.status}).`, res.status, json?.code ?? null);
  }
  return json as T;
}
