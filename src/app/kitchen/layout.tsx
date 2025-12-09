
import { KitchenHeader } from "@/components/kitchen/header";
import { AuthProvider } from "@/context/auth-context";
import { SuccessConfirm } from "@/components/ui/success-confirm";

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <div className="flex min-h-svh w-full flex-col bg-muted/40">
        <KitchenHeader />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
        <SuccessConfirm />
      </div>
    </AuthProvider>
  );
}
