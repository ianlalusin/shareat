
import { CashierHeader } from "@/components/cashier/header";

export default function RefillLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-muted/40">
      {/* Intentionally reusing cashier header as it has the store selector */}
      <CashierHeader /> 
      {children}
    </div>
  );
}
