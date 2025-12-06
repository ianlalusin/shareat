import { CashierHeader } from "@/components/cashier/header";

export default function CashierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background">
      <CashierHeader />
      {children}
    </div>
  );
}
