
import { CashierHeader } from "@/components/cashier/header";
import { FirstLoginGuard } from "@/components/auth/first-login-guard";

export default function CashierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FirstLoginGuard>
      <div className="flex min-h-svh w-full flex-col bg-background">
        <CashierHeader />
        {children}
      </div>
    </FirstLoginGuard>
  );
}
