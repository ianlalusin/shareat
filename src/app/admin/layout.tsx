
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminHeader } from "@/components/admin/header";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
} from "@/components/ui/sidebar";
import { SuccessConfirm } from "@/components/ui/success-confirm";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
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
  );
}
