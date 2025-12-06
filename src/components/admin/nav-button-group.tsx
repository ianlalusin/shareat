import { Button } from "@/components/ui/button";
import Link from "next/link";

export function NavButtonGroup() {
  return (
    <div className="hidden md:flex items-center gap-1 rounded-lg bg-primary-foreground/10 p-1">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
      >
        <Link href="/cashier">Cashier</Link>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
      >
        Kitchen
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
      >
        Refill
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="bg-primary-foreground text-primary shadow-sm hover:bg-primary-foreground/90"
      >
        Admin
      </Button>
    </div>
  );
}
