
import { ReactNode } from "react";

// This is a clean layout without any guards or special headers/sidebars,
// perfect for public-facing pages like login, signup, and the new onboarding flow.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
