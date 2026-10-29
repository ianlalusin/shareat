import { auth } from "@/lib/firebase/client";

type ToastFn = (t: { variant?: "destructive"; title: string; description?: string }) => unknown;

/**
 * Fire-and-forget: after a PAID receipt is voided or refunded, ask the server
 * to take back the loyalty points it earned and return vouchers used on it
 * (/api/loyalty/reverse-receipt, idempotent). Never throws; a failure shows a
 * toast so staff can tell an admin, like the earn call at checkout.
 */
export function reverseReceiptLoyalty(
  args: { storeId: string; receiptId: string; reason: "receipt_void" | "refund"; refundReceiptId?: string },
  toast: ToastFn,
): void {
  void (async () => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");
      const token = await user.getIdToken();
      const res = await fetch("/api/loyalty/reverse-receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(args),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        toast({
          variant: "destructive",
          title: "Loyalty reversal failed",
          description: data?.error || "Points/vouchers on this receipt were not reversed — please notify admin.",
        });
      } else if (Number(data?.points?.shortfall) > 0) {
        toast({
          title: "Loyalty points partly reversed",
          description: `${data.points.shortfall} point(s) could not be taken back (customer already spent them).`,
        });
      }
    } catch (err: any) {
      console.error("[Loyalty] reversal failed for receipt", args.receiptId, err);
      toast({
        variant: "destructive",
        title: "Loyalty reversal failed",
        description: "Network error — points/vouchers were not reversed. Admin can adjust manually.",
      });
    }
  })();
}
