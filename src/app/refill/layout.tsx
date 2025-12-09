
import { CashierHeader } from "@/components/cashier/header";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";

export default function RefillLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <div className="flex min-h-svh w-full flex-col bg-muted/40">
        {/* Intentionally reusing cashier header as it has the store selector */}
        <CashierHeader />
        {children}
      </div>
    </FirstLoginGuard>
  );
}
