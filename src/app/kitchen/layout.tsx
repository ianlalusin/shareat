
import { KitchenHeader } from "@/components/kitchen/header";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";
import { ConnectivityBanner } from "@/components/ui/connectivity-banner";
import { SyncStatusBadge } from "@/components/layout/sync-status-badge";

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <div className="flex min-h-svh w-full flex-col bg-muted/40">
        <KitchenHeader />
        <ConnectivityBanner />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
        <SyncStatusBadge />
      </div>
    </FirstLoginGuard>
  );
}
