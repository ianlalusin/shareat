
import { CashierHeader } from "@/components/cashier/header";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";
import { ConnectivityBanner } from "@/components/ui/connectivity-banner";
import { SyncStatusBadge } from "@/components/layout/sync-status-badge";

export default function CashierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <div className="flex min-h-svh w-full flex-col bg-background">
        <CashierHeader />
        <ConnectivityBanner />
        <div className="flex-1 flex flex-col">
          {children}
        </div>
        <SyncStatusBadge />
      </div>
    </FirstLoginGuard>
  );
}
