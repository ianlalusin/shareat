import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";

export const runtime = "nodejs";

const MAX_ADS = 30;
const STILL_SECONDS = 10;
const TYPES = new Set(["image", "gif", "video"]);

/**
 * One branch's TV ads for the SharEat Ads TV app (net.shareat.tvads). Uploaded by
 * admins on CUSTOMER /admin/tv-ads into `tvAds/{id}`. Same auth contract as
 * /api/external/live-summary. `version` changes whenever the list does, so the TV
 * only downloads when something changed.
 */
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const storeId = new URL(request.url).searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });

  try {
    // shortcut: filters branches in code; fine for tens of ads, add an index'd query if it grows to thousands.
    const snap = await getAdminDb().collection("tvAds").where("active", "==", true).get();
    const ads = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((a) => TYPES.has(a.type) && typeof a.url === "string" && a.url)
      .filter((a) => a.storeIds === "all" || (Array.isArray(a.storeIds) && a.storeIds.includes(storeId)))
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
      .slice(0, MAX_ADS)
      .map((a) => ({
        id: a.id,
        type: a.type as string,
        url: a.url as string,
        bytes: Number(a.bytes) || 0,
        seconds: a.type === "video" ? Number(a.durationSec) || 0 : STILL_SECONDS,
      }));
    const version = createHash("sha1").update(ads.map((a) => `${a.id}:${a.url}`).join("\n")).digest("hex");
    return NextResponse.json({ storeId, version, ads });
  } catch (err) {
    console.error("[external/tv-ads]", err);
    return NextResponse.json({ error: "Failed to load ads." }, { status: 500 });
  }
}
