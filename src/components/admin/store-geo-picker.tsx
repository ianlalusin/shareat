"use client";

import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MANILA = { lat: 14.5995, lng: 120.9842 };
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID";

interface Props {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
}

/**
 * Geotag picker for a store. With a Google Maps key configured it shows a draggable
 * pin on a live map; without one it degrades to plain lat/lng inputs so the geotag
 * still works. Coordinates are kept as strings (RHF fields) and parsed on save.
 */
export function StoreGeoPicker({ lat, lng, onChange }: Props) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  const hasCoords = lat.trim() !== "" && lng.trim() !== "" && !Number.isNaN(nLat) && !Number.isNaN(nLng);
  const center = hasCoords ? { lat: nLat, lng: nLng } : MANILA;

  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  return (
    <div className="space-y-2">
      {MAPS_KEY ? (
        <APIProvider apiKey={MAPS_KEY}>
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
            Click the map or drag the pin to set the location, or type coordinates below.
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
