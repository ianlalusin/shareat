import { KitchenHeader } from "@/components/kitchen/header";

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-svh w-full flex-col bg-muted/40">
      <KitchenHeader />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
