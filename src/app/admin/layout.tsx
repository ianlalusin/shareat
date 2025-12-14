
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/header";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
} from "@/components/ui/sidebar";
import { SuccessConfirm } from "@/components/ui/success-confirm";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";
import { RoleGate } from "@/components/auth/role-gate";
import { ConnectivityBanner } from "@/components/ui/connectivity-banner";
import { SyncStatusBadge } from "@/components/layout/sync-status-badge";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <AdminSidebar />
        </Sidebar>
        <SidebarInset>
          <AdminHeader />
          <ConnectivityBanner />
          <div className="flex-1 flex flex-col">
            {children}
          </div>
          <SyncStatusBadge />
          <SuccessConfirm />
        </SidebarInset>
      </SidebarProvider>
    </FirstLoginGuard>
  );
}
