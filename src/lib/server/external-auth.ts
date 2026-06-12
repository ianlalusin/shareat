import "server-only";

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare that won't throw on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type ExternalKeyScope = {
  /** Non-null = auth failed; the route should return this response as-is. */
  response: NextResponse | null;
  /** null = unrestricted (global key, all active stores); array = allow-list. */
  allowedStoreIds: string[] | null;
};

/**
 * Resolve the calling key's store scope.
 *
 * Backward-compatible: the existing single `POS_EXTERNAL_API_KEY` keeps working
 * and is unrestricted (allowedStoreIds = null). Optionally, a JSON map in
 * `POS_EXTERNAL_API_KEYS_JSON` ({ "<key>": ["storeId", ...] }) defines additional
 * per-consumer keys that may only query their listed stores.
 */
export function resolveExternalKeyScope(request: Request): ExternalKeyScope {
  const apiKey = request.headers.get("x-api-key")?.trim();
  const globalKey = process.env.POS_EXTERNAL_API_KEY?.trim();

  let scopedKeys: Record<string, string[]> = {};
  const rawMap = process.env.POS_EXTERNAL_API_KEYS_JSON?.trim();
  if (rawMap) {
    try {
      const parsed = JSON.parse(rawMap);
      if (parsed && typeof parsed === "object") scopedKeys = parsed as Record<string, string[]>;
    } catch {
      console.error("[external-auth] POS_EXTERNAL_API_KEYS_JSON is not valid JSON; ignoring");
    }
  }

  if (!globalKey && Object.keys(scopedKeys).length === 0) {
    console.error("[external-auth] no external API key configured");
    return { response: NextResponse.json({ error: "Server misconfigured." }, { status: 500 }), allowedStoreIds: null };
  }

  if (!apiKey) {
    return { response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }), allowedStoreIds: null };
  }

  // Global key → unrestricted (today's behavior).
  if (globalKey && safeEqual(apiKey, globalKey)) {
    return { response: null, allowedStoreIds: null };
  }

  // Scoped key → restricted to its store list.
  for (const [key, stores] of Object.entries(scopedKeys)) {
    if (safeEqual(apiKey, key)) {
      const ids = Array.isArray(stores) ? stores.map(String).filter(Boolean) : [];
      return { response: null, allowedStoreIds: ids };
    }
  }

  return { response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }), allowedStoreIds: null };
}

/** True if this key may query the given store. */
export function storeAllowed(scope: ExternalKeyScope, storeId: string): boolean {
  return scope.allowedStoreIds === null || scope.allowedStoreIds.includes(storeId);
}

/**
 * Backward-compatible auth-only helper (no per-store scope enforcement).
 * Returns a NextResponse to short-circuit on failure, or null when auth passes.
 */
export function validateExternalApiKey(request: Request): NextResponse | null {
  return resolveExternalKeyScope(request).response;
}
