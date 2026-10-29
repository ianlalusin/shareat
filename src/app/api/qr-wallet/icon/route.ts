import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import {
  isAllowedIconHost,
  resolveIconCandidates,
  type IconCandidateUrl,
} from "@/lib/qr/brand-domains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling on a fetched icon. A favicon is a few KB; 256 KB is generous. */
const MAX_ICON_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 3500;
const MAX_CANDIDATES = 4;

const QuerySchema = z.object({
  storeId: z.string().min(1).max(128),
  name: z.string().min(1).max(60),
  provider: z.string().max(60).optional().default(""),
});

const RASTER_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/gif",
]);

/** Markup that must never reach a stored SVG. */
const HOSTILE_SVG = /<script|<foreignObject|javascript:|\son\w+\s*=/i;

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Google's favicon endpoint NEVER 404s — for an unknown domain it returns a
 * generic globe. Measured: zzzznotarealbrand12345.com, paymaya.com and
 * seabank.com.ph all returned the SAME 726-byte body.
 *
 * Without this filter every manager gets a globe and believes the fetch worked.
 * The sentinel is learned at runtime from a domain that cannot exist, so it
 * self-heals if Google ever changes the placeholder — far better than hard-
 * coding today's hash.
 */
let globeHashPromise: Promise<string | null> | null = null;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function getGlobeHash(): Promise<string | null> {
  if (!globeHashPromise) {
    globeHashPromise = (async () => {
      try {
        const probe = `zzz-${randomUUID()}.invalid`;
        const res = await fetch(
          `https://www.google.com/s2/favicons?domain=${probe}&sz=256`,
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
        );
        if (!res.ok) return null;
        return sha256(new Uint8Array(await res.arrayBuffer()));
      } catch {
        return null;
      }
    })();
  }
  return globeHashPromise;
}

/** Reads a response body, aborting past the cap rather than buffering it all. */
async function readCapped(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_ICON_BYTES) return null;

  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ICON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

type FetchedIcon = {
  id: string;
  source: string;
  contentType: string;
  bytesBase64: string;
  byteLength: number;
};

async function fetchCandidate(
  candidate: IconCandidateUrl,
  globeHash: string | null,
): Promise<FetchedIcon | null> {
  // Defence in depth: the URL is built from an allowlisted template, but assert
  // the host before the request and again after any redirect.
  if (!isAllowedIconHost(candidate.host)) return null;

  try {
    const res = await fetch(candidate.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "image/*" },
    });
    if (!res.ok) return null;

    const finalHost = new URL(res.url || candidate.url).hostname;
    if (!isAllowedIconHost(finalHost)) return null;

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const isSvg = contentType === "image/svg+xml";
    // SVG is only trusted from Simple Icons, which serves curated brand marks.
    if (isSvg && candidate.source !== "simpleicons") return null;
    if (!isSvg && !RASTER_TYPES.has(contentType)) return null;

    const bytes = await readCapped(res);
    if (!bytes || bytes.byteLength === 0) return null;

    if (isSvg) {
      const text = new TextDecoder().decode(bytes);
      // It will only ever render via <img src>, where scripts do not execute —
      // but a hostile SVG sitting in the Storage bucket is not a thing worth
      // having to explain.
      if (HOSTILE_SVG.test(text)) return null;
    }

    if (globeHash && sha256(bytes) === globeHash) return null;

    return {
      id: candidate.id,
      source: candidate.source,
      contentType,
      bytesBase64: Buffer.from(bytes).toString("base64"),
      byteLength: bytes.byteLength,
    };
  } catch {
    // A dead third party must never fail the request — the client falls back to
    // the deterministic initials badge.
    return null;
  }
}

/**
 * Suggests brand icons for a saved QR.
 *
 * Fetches server-side and returns bytes inline as base64, which is the key
 * move: the browser never makes a cross-origin image request, so CORS never
 * enters the picture and the APK needs no special handling. The client uploads
 * whichever candidate the manager picks.
 *
 * Always non-blocking for the caller — an empty candidate list is a valid
 * answer, and the QR still saves with initials.
 */
export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") ?? "";
    const match = authz.match(/^Bearer\s+(.+)$/i);
    if (!match) return fail("Missing Authorization Bearer token.", 401);

    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      storeId: url.searchParams.get("storeId") ?? "",
      name: url.searchParams.get("name") ?? "",
      provider: url.searchParams.get("provider") ?? "",
    });
    if (!parsed.success) return fail("storeId and name are required.");

    const decoded = await getAdminAuth().verifyIdToken(match[1], true);
    await requireStaffStoreAccess(getAdminDb(), decoded, parsed.data.storeId, [
      "admin",
      "manager",
    ]);

    const candidates = resolveIconCandidates(parsed.data.provider, parsed.data.name);
    if (candidates.length === 0) {
      return NextResponse.json({ ok: true, candidates: [] });
    }

    const globeHash = await getGlobeHash();
    const settled = await Promise.all(candidates.map((c) => fetchCandidate(c, globeHash)));

    const found: FetchedIcon[] = [];
    const seen = new Set<string>();
    for (const icon of settled) {
      if (!icon) continue;
      // Different sources often serve the identical favicon; show it once.
      const fingerprint = `${icon.contentType}:${icon.byteLength}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      found.push(icon);
      if (found.length >= MAX_CANDIDATES) break;
    }

    return NextResponse.json(
      { ok: true, candidates: found },
      { headers: { "Cache-Control": "private, max-age=86400" } },
    );
  } catch (error: any) {
    const message = error?.message ?? "Unknown error";
    const status = /not allowed|no access|not a staff|not active|token/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
