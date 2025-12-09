
import { CashierHeader } from "@/components/cashier/header";
import { AuthProvider } from "@/context/auth-context";
import { SuccessConfirm } from "@/components/ui/success-confirm";

export default function CashierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-svh w-full flex-col bg-background">
        <CashierHeader />
        {children}
        <SuccessConfirm />
      </div>
    </AuthProvider>
  );
}
