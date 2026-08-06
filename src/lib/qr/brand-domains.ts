/**
 * Resolves a wallet/bank name into candidate icon sources.
 *
 * Pure and dependency-free so it can be unit-tested without network access; the
 * route that consumes it does the fetching.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MEASURED, NOT ASSUMED — probe results that shaped this file:
 *
 *   cdn.simpleicons.org/gcash    → 404   (Simple Icons has no GCash)
 *   cdn.simpleicons.org/paymaya  → 404   (…and no Maya)
 *   logo.clearbit.com/gcash.com  → connection failed; the Clearbit logo API is
 *                                  effectively dead post-HubSpot. Do not use.
 *   google.com/s2/favicons?...   → 200 for gcash.com, bpi.com.ph, maya.ph
 *   icons.duckduckgo.com/ip3/... → 200
 *
 * So domain→favicon is the PRIMARY strategy and Simple Icons is a bonus tier
 * (it self-filters by 404ing on a miss). The tempting "use Simple Icons, it's
 * deterministic and license-clean" plan does not survive contact with PH
 * payment brands.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type IconCandidateSource = "favicon" | "duckduckgo" | "simpleicons";

export type IconCandidateUrl = {
  id: string;
  url: string;
  source: IconCandidateSource;
  /** Host that must appear in the allowlist, pre- and post-redirect. */
  host: string;
};

/** Hosts the route may fetch from. Enforced on the request AND the final URL. */
export const ICON_HOST_ALLOWLIST = [
  "www.google.com",
  "t3.gstatic.com",
  "icons.duckduckgo.com",
  "cdn.simpleicons.org",
] as const;

/** Only a plain hostname may be interpolated into a third-party query string. */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Curated Philippine wallet/bank domains — the high-value tier. A manager
 * typing "gcash" must land on the right logo without depending on a domain
 * guess that happens to resolve.
 */
const PROVIDER_DOMAINS: Record<string, string> = {
  gcash: "gcash.com",
  maya: "maya.ph",
  paymaya: "maya.ph",
  grabpay: "grab.com",
  grab: "grab.com",
  shopeepay: "shopee.ph",
  shopee: "shopee.ph",
  unionbank: "unionbankph.com",
  ub: "unionbankph.com",
  bpi: "bpi.com.ph",
  bdo: "bdo.com.ph",
  metrobank: "metrobank.com.ph",
  landbank: "landbank.com",
  seabank: "seabank.com.ph",
  gotyme: "gotyme.com.ph",
  tonik: "tonikbank.com",
  coins: "coins.ph",
  palawanpay: "palawanpay.com",
  palawan: "palawanpay.com",
  cebuana: "cebuanalhuillier.com",
  securitybank: "securitybank.com",
  chinabank: "chinabank.ph",
  rcbc: "rcbc.com",
  netbank: "netbank.ph",
  eastwest: "eastwestbanker.com",
  pnb: "pnb.com.ph",
};

/** Lowercases and strips to [a-z0-9] so "GCash — Ate Malou" → "gcashatemalou". */
export function normalizeName(value: string): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First token of a name, used when the whole string is too specific to match. */
function firstWordSlug(value: string): string {
  const [first = ""] = (value ?? "").toLowerCase().split(/[\s\-–—_/]+/).filter(Boolean);
  return first.replace(/[^a-z0-9]/g, "");
}

export function isAllowedIconHost(host: string): boolean {
  return (ICON_HOST_ALLOWLIST as readonly string[]).includes(host);
}

function faviconCandidates(domain: string): IconCandidateUrl[] {
  return [
    {
      id: `favicon:${domain}`,
      url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`,
      source: "favicon",
      host: "www.google.com",
    },
    {
      id: `ddg:${domain}`,
      url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
      source: "duckduckgo",
      host: "icons.duckduckgo.com",
    },
  ];
}

/**
 * Candidate icon URLs for a provider key and/or a typed name, best first.
 *
 * `provider` comes from guessProvider() in emvco.ts and is trusted; `name` is
 * whatever the manager typed and is only ever used to derive a slug that must
 * pass DOMAIN_PATTERN before it reaches a URL.
 */
export function resolveIconCandidates(provider: string, name: string): IconCandidateUrl[] {
  const candidates: IconCandidateUrl[] = [];
  const seen = new Set<string>();

  const push = (entries: IconCandidateUrl[]) => {
    for (const entry of entries) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      candidates.push(entry);
    }
  };

  const domains: string[] = [];
  const addDomain = (domain: string) => {
    if (domain && DOMAIN_PATTERN.test(domain) && !domains.includes(domain)) domains.push(domain);
  };

  // 1. Curated map, by provider key then by the typed name.
  const providerKey = normalizeName(provider);
  if (providerKey && providerKey !== "generic" && PROVIDER_DOMAINS[providerKey]) {
    addDomain(PROVIDER_DOMAINS[providerKey]);
  }
  const nameKey = normalizeName(name);
  if (PROVIDER_DOMAINS[nameKey]) addDomain(PROVIDER_DOMAINS[nameKey]);

  const wordKey = firstWordSlug(name);
  if (PROVIDER_DOMAINS[wordKey]) addDomain(PROVIDER_DOMAINS[wordKey]);

  // 2. The manager typed something that already looks like a domain.
  const typed = (name ?? "").trim().toLowerCase();
  if (typed.includes(".")) addDomain(typed);

  // 3. Guess, narrowest first. Only from the first word — guessing
  //    "gcashatemalou.com" helps nobody.
  if (wordKey.length >= 3) {
    addDomain(`${wordKey}.com.ph`);
    addDomain(`${wordKey}.ph`);
    addDomain(`${wordKey}.com`);
  }

  for (const domain of domains) push(faviconCandidates(domain));

  // 4. Simple Icons last — it 404s on a miss, so a hit is a genuine brand mark.
  const slug = providerKey && providerKey !== "generic" ? providerKey : wordKey;
  if (slug.length >= 2) {
    push([
      {
        id: `simpleicons:${slug}`,
        url: `https://cdn.simpleicons.org/${encodeURIComponent(slug)}`,
        source: "simpleicons",
        host: "cdn.simpleicons.org",
      },
    ]);
  }

  return candidates;
}
