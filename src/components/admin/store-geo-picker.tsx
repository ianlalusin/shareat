"use client";

import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";

const MANILA = { lat: 14.5995, lng: 120.9842 };
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

const round = (n: number) => Math.round(n * 1e6) / 1e6;

interface Props {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
}

/**
 * Search box that taps Google Places. Type a store name / address, pick a
 * suggestion, and the pin drops on that exact place. (Google doesn't expose a
 * user's personal "saved places" to third-party apps, so this searches the
 * public Places database — the practical way to pin a precise location.)
 */
function PlaceSearch({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const places = useMapsLibrary("places");
  const map = useMap();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!places || !inputRef.current) return;
    const ac = new places.Autocomplete(inputRef.current, {
      fields: ["geometry", "formatted_address", "name"],
      componentRestrictions: { country: "ph" },
    });
    const listener = ac.addListener("place_changed", () => {
      const loc = ac.getPlace()?.geometry?.location;
      if (!loc) return;
      const lat = loc.lat();
      const lng = loc.lng();
      onPick(lat, lng);
      if (map) {
        map.panTo({ lat, lng });
        map.setZoom(17);
      }
    });
    return () => listener.remove();
  }, [places, map, onPick]);

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        className="pl-8"
        placeholder="Search a place or address (e.g. SM City Lipa)…"
        // Stop the parent <form> from submitting when the user presses Enter on
        // a suggestion.
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
    </div>
  );
}

/** Pans the map whenever the chosen coordinates change (search / drag / manual). */
function MapPanner({ lat, lng, hasCoords }: { lat: number; lng: number; hasCoords: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (map && hasCoords) map.panTo({ lat, lng });
  }, [map, lat, lng, hasCoords]);
  return null;
}

/**
 * Geotag picker for a store. With a Google Maps key configured it shows a Places
 * search box + a draggable pin on a live map; without one it degrades to plain
 * lat/lng inputs so the geotag still works. Coordinates are kept as strings (RHF
 * fields) and parsed on save.
 */
export function StoreGeoPicker({ lat, lng, onChange }: Props) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  const hasCoords = lat.trim() !== "" && lng.trim() !== "" && !Number.isNaN(nLat) && !Number.isNaN(nLng);
  const center = hasCoords ? { lat: nLat, lng: nLng } : MANILA;

  return (
    <div className="space-y-2">
      {MAPS_KEY ? (
        <APIProvider apiKey={MAPS_KEY}>
          <PlaceSearch onPick={(la, ln) => onChange(String(round(la)), String(round(ln)))} />
          <div className="h-56 w-full overflow-hidden rounded-md border">
            <Map
              defaultCenter={center}
              defaultZoom={hasCoords ? 16 : 11}
              mapId={MAP_ID}
              gestureHandling="greedy"
              disableDefaultUI={false}
              onClick={(e: any) => {
                const ll = e?.detail?.latLng;
                if (ll) onChange(String(round(ll.lat)), String(round(ll.lng)));
              }}
              style={{ width: "100%", height: "100%" }}
            >
              <MapPanner lat={nLat} lng={nLng} hasCoords={hasCoords} />
              {hasCoords && (
                <AdvancedMarker
                  position={center}
                  draggable
                  onDragEnd={(e: any) => {
                    const ll = e?.latLng;
                    if (ll) onChange(String(round(ll.lat())), String(round(ll.lng())));
                  }}
                />
              )}
            </Map>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Search a place above, or click the map / drag the pin to fine-tune. Coordinates fill in below.
          </p>
        </APIProvider>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable the live map. Meanwhile, paste the
          coordinates from Google Maps below (right-click the store pin → click the lat,&nbsp;lng to copy).
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="geo-lat" className="text-xs">Latitude</Label>
          <Input
            id="geo-lat"
            inputMode="decimal"
            placeholder="14.5995"
            value={lat}
            onChange={(e) => onChange(e.target.value, lng)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="geo-lng" className="text-xs">Longitude</Label>
          <Input
            id="geo-lng"
            inputMode="decimal"
            placeholder="120.9842"
            value={lng}
            onChange={(e) => onChange(lat, e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
