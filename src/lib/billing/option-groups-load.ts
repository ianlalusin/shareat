import type { OptionGroup } from "@/lib/types";

/**
 * F08: loading a product's modifier (option-group) config for the cashier.
 *
 * Only an authoritative successful response counts — `{ ok: true,
 * optionGroups: [...] }` with HTTP 2xx and a well-formed array. A successful
 * empty list means "no modifiers" and the item can be added directly. Any
 * other outcome (no auth token, network error/offline, non-2xx, bad JSON,
 * malformed groups) is "unavailable": the caller must NOT add the item without
 * its modifiers. The last good result per store+product is cached for the
 * page lifetime so an offline retry can still use a known schema.
 */

export type OptionGroupsLoadResult =
  | { status: "ok"; groups: OptionGroup[]; fromCache: boolean }
  | { status: "unavailable"; reason: string };

const cache = new Map<string, OptionGroup[]>();
const key = (storeId: string, productId: string) => `${storeId}::${productId}`;

/** Test hook. */
export function __clearOptionGroupsCache() {
  cache.clear();
}

function isValidGroup(g: unknown): g is OptionGroup {
  if (!g || typeof g !== "object") return false;
  const o = g as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return false;
  if (o.selectionMode !== "single" && o.selectionMode !== "multi") return false;
  if (!Array.isArray(o.values)) return false;
  return o.values.every((v) => {
    if (!v || typeof v !== "object") return false;
    const delta = (v as any).priceDelta;
    return typeof (v as any).id === "string" && (delta === undefined || delta === null || Number.isFinite(Number(delta)));
  });
}

export function parseOptionGroupsResponse(httpOk: boolean, json: unknown): OptionGroupsLoadResult {
  if (!httpOk) return { status: "unavailable", reason: "server_error" };
  const body = json as any;
  if (!body || body.ok !== true || !Array.isArray(body.optionGroups)) {
    return { status: "unavailable", reason: "malformed" };
  }
  if (!body.optionGroups.every(isValidGroup)) return { status: "unavailable", reason: "malformed" };
  return { status: "ok", groups: body.optionGroups as OptionGroup[], fromCache: false };
}

export async function loadOptionGroups(args: {
  storeId: string;
  productId: string;
  getIdToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): Promise<OptionGroupsLoadResult> {
  const { storeId, productId, getIdToken } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  const k = key(storeId, productId);

  const fallback = (reason: string): OptionGroupsLoadResult => {
    const cached = cache.get(k);
    return cached ? { status: "ok", groups: cached, fromCache: true } : { status: "unavailable", reason };
  };

  let token: string | null = null;
  try {
    token = await getIdToken();
  } catch {
    return fallback("auth");
  }
  if (!token) return fallback("auth");

  let res: Response;
  try {
    res = await fetchImpl(
      `/api/products/${encodeURIComponent(productId)}/option-groups?storeId=${encodeURIComponent(storeId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    return fallback("network");
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const parsed = parseOptionGroupsResponse(res.ok, json);
  if (parsed.status === "ok") {
    cache.set(k, parsed.groups);
    return parsed;
  }
  return fallback(parsed.reason);
}
