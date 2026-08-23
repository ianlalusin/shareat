/**
 * Turn a store's map pin + free-text address into the locale string the holiday
 * AI is prompted with.
 *
 * Why both, rather than one or the other (measured 2026-08-22 against the real
 * Geocoding API for all three AI stores):
 *
 * - The **pin is authoritative for city/province** and cannot be vague. This is
 *   the layer that failed: SharEat Lipa's address was the bare street "Calle
 *   Arzobispado", which is a real street in Intramuros, so the model placed the
 *   store in Manila and produced Araw ng Maynila as its local fiesta.
 * - The **pin is NOT reliable at barangay level.** Reverse-geocoding Lipa's pin
 *   returns two conflicting sublocalities across result rows (`Bulacnin` and
 *   `San Carlos`), and Davao's returns the district `Talomo` rather than the
 *   barangay `Matina-Aplaya` that its address names — and it is the barangay
 *   that actually finds a fiesta. So `sublocality` is deliberately discarded.
 *
 * Hence: address supplies the fine-grained naming, the pin supplies a city
 * anchor the address cannot contradict.
 */

export type GeoPoint = { lat: number; lng: number };

export type GeoAnchor = {
  locality?: string;
  province?: string;
  country?: string;
};

/**
 * Pull ONLY the coarse, trustworthy components out of a Geocoding API response.
 * Returns null for any non-OK response or when nothing usable is present, so
 * every failure path collapses to "no anchor" rather than throwing.
 */
export function extractAnchor(geocodeJson: any): GeoAnchor | null {
  if (!geocodeJson || geocodeJson.status !== "OK" || !Array.isArray(geocodeJson.results)) return null;

  const anchor: GeoAnchor = {};
  for (const result of geocodeJson.results) {
    for (const comp of result?.address_components ?? []) {
      const types: string[] = comp?.types ?? [];
      // First occurrence wins; later result rows are coarser or noisier.
      if (!anchor.locality && types.includes("locality")) anchor.locality = comp.long_name;
      if (!anchor.province && types.includes("administrative_area_level_2")) anchor.province = comp.long_name;
      if (!anchor.country && types.includes("country")) anchor.country = comp.long_name;
    }
  }

  return anchor.locality || anchor.province || anchor.country ? anchor : null;
}

function anchorText(anchor: GeoAnchor): string {
  return [anchor.locality, anchor.province, anchor.country].filter(Boolean).join(", ");
}

/**
 * Compose the prompt locale, **verified city first**.
 *
 * Appending the verified location after the raw address was not enough. Lipa's
 * address begins "Calle Arzobispado", a well-known Intramuros street, and the
 * model kept emitting Araw ng Maynila and the Intramuros Grand Marian
 * Procession as its local fiestas even with ", Lipa City, Batangas" in the same
 * string and a verified suffix after it — the famous street name simply
 * outweighed the rest.
 *
 * So the pin now leads and the address follows as a within-city locator, which
 * is the only job it is actually good at (barangay-level naming: "Santiago,
 * Malvar" is what finds the Barangay Santiago fiesta). The prompt carries a
 * matching rule telling the model the named city governs.
 */
export function buildLocale(address: string | undefined | null, anchor: GeoAnchor | null): string {
  const addr = (address ?? "").trim();
  const anchored = anchor ? anchorText(anchor) : "";

  if (anchored && addr) return `${anchored} — specifically the area around "${addr}" within that city`;
  if (anchored) return anchored;
  if (addr) return addr;
  return "Philippines";
}

/**
 * Reverse-geocode a store pin. Never throws and never blocks the caller for
 * long: any failure (missing key, denied, rate-limited, timeout, bad JSON)
 * returns null, and the caller falls back to the address alone — i.e. the
 * behaviour that existed before this was added.
 */
export async function reverseGeocode(
  geo: GeoPoint | null | undefined,
  apiKey: string | undefined,
  timeoutMs = 8000,
): Promise<GeoAnchor | null> {
  if (!geo || typeof geo.lat !== "number" || typeof geo.lng !== "number") return null;
  if (!apiKey) {
    console.warn("[geo-locale] no Maps API key at runtime; falling back to address-only locale");
    return null;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${geo.lat},${geo.lng}&key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[geo-locale] geocode HTTP ${res.status}; falling back to address-only locale`);
      return null;
    }
    const json = await res.json();
    if (json?.status !== "OK") {
      // error_message can name a key restriction — useful, and it contains no secret.
      console.warn(`[geo-locale] geocode status ${json?.status}: ${json?.error_message ?? "(no message)"}`);
      return null;
    }
    return extractAnchor(json);
  } catch (err: any) {
    console.warn(`[geo-locale] geocode failed (${err?.name ?? "error"}); falling back to address-only locale`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
