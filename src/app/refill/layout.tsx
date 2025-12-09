
import { CashierHeader } from "@/components/cashier/header";
import { AuthProvider } from "@/context/auth-context";
import { SuccessConfirm } from "@/components/ui/success-confirm";

export default function RefillLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-svh w-full flex-col bg-muted/40">
        {/* Intentionally reusing cashier header as it has the store selector */}
        <CashierHeader />
        {children}
        <SuccessConfirm />
      </div>
    </AuthProvider>
  );
}
