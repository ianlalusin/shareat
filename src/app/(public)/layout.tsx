
import { PasskeyGate } from "@/components/auth/passkey-gate";
import { ReactNode } from "react";

// This is a clean layout without any guards or special headers/sidebars,
// perfect for public-facing pages like login, signup, and the new onboarding flow.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <PasskeyGate>
      <div className="flex min-h-svh w-full items-center justify-center bg-muted/40 p-4">
        {children}
      </div>
    </PasskeyGate>
  );
}
