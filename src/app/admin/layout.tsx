
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/header";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
} from "@/components/ui/sidebar";
import { SuccessConfirm } from "@/components/ui/success-confirm";
import { PinLock } from "@/components/admin/pin-lock";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <PinLock>
        <SidebarProvider>
          <Sidebar collapsible="icon">
            <AdminSidebar />
          </Sidebar>
          <SidebarInset>
            <AdminHeader />
            {children}
            <SuccessConfirm />
          </SidebarInset>
        </SidebarProvider>
      </PinLock>
    </FirstLoginGuard>
  );
}
