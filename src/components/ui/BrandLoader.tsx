"use client";

import Image from "next/image";

export function BrandLoader() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-20 w-20">
        {/* spinning ring */}
        <div className="absolute inset-0 rounded-full border-4 border-muted border-t-foreground animate-spin" />

        {/* logo */}
        <div className="absolute inset-2 rounded-full overflow-hidden bg-black/10">
          <Image
            src="/logo.png"
            alt="SharEat"
            fill
            className="object-contain p-2"
            priority
          />
        </div>
      </div>

      <div className="text-center">
        <div className="text-lg font-semibold">Logging you in…</div>
        <div className="text-sm text-muted-foreground mt-1">
          Please wait while we load your profile
        </div>
      </div>
    </div>
  );
}
