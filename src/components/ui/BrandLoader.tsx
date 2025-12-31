
"use client";

import Image from "next/image";
import { Logo } from "../icons";

export function BrandLoader() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-20 w-20">
        {/* spinning ring */}
        <div className="absolute inset-0 rounded-full border-4 border-muted border-t-primary animate-spin" />

        {/* logo */}
        <div className="absolute inset-2 flex items-center justify-center">
            <Logo className="h-10 w-10 text-primary" />
        </div>
      </div>

      <div className="text-center">
        <div className="text-lg font-semibold">Loading...</div>
        <div className="text-sm text-muted-foreground mt-1">
          Please wait while we prepare the application.
        </div>
      </div>
    </div>
  );
}
