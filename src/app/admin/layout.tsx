
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

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RoleGate allow={['admin', 'manager']}>
      <FirstLoginGuard>
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <AdminSidebar />
          </Sidebar>
          <SidebarInset>
            <AdminHeader />
            <ConnectivityBanner />
            {children}
            <SuccessConfirm />
          </SidebarInset>
        </SidebarProvider>
      </FirstLoginGuard>
    </RoleGate>
  );
}
