"use client";

import { useState } from "react";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, KeyRound, Copy, Printer, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { isNativeBluetoothAvailable, getLastPrinterAddress, printViaNativeBluetooth } from "@/lib/printing/printHub";
import { formatSharelebratorPasswordText } from "@/lib/printing/receiptFormatter";

type LedgerEntry = {
  id: string;
  type: "earn" | "redeem" | "adjust";
  points: number;
  amount: number;
  storeId: string;
  sessionId: string;
  createdAtMs: number | null;
};

type Customer = {
  phone: string;
  name: string;
  address: string;
  email: string | null;
  bday: string;
  pointsBalance: number;
  createdAtMs: number | null;
  passwordResetAtMs: number | null;
};

export function CustomersAdmin() {
  const { user, appUser } = useAuthContext();
  const { confirm, Dialog } = useConfirmDialog();
  const { toast } = useToast();

  const [phoneInput, setPhoneInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const canReset =
    appUser?.role === "admin" || appUser?.role === "manager" || appUser?.isPlatformAdmin;

  async function handleSearch() {
    if (!phoneInput.trim() || !user) return;
    setLoading(true);
    setNotFound(false);
    setCustomer(null);
    setLedger([]);
    setTempPassword(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/loyalty/lookup?phone=${encodeURIComponent(phoneInput.trim())}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Lookup failed.");
      if (!json.found) {
        setNotFound(true);
      } else {
        setCustomer(json.customer);
        setLedger(json.ledger || []);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!customer || !user) return;
    const ok = await confirm({
      title: "Reset password?",
      description: `A new temporary password will be generated for ${customer.name}. The old password will no longer work.`,
      confirmText: "Reset",
      destructive: true,
    });
    if (!ok) return;

    setResetting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/loyalty/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phone: customer.phone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Reset failed.");
      setTempPassword(json.newPassword);
      toast({ title: "Password reset", description: "Share the new password with the customer." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  function copyPassword() {
    if (!tempPassword) return;
    navigator.clipboard.writeText(tempPassword);
    toast({ title: "Copied", description: "Temporary password copied to clipboard." });
  }

  async function printPassword() {
    if (!tempPassword || !customer) return;

    // Native Android (Capacitor) → Bluetooth thermal printer
    if (isNativeBluetoothAvailable()) {
      const addr = getLastPrinterAddress();
      if (!addr) {
        toast({
          title: "No printer",
          description: "Connect a printer in Settings first.",
          variant: "destructive",
        });
        return;
      }
      try {
        const paperWidth = ((): 58 | 80 => {
          try {
            return localStorage.getItem("receiptPaperWidth:global") === "58mm" ? 58 : 80;
          } catch {
            return 80;
          }
        })();
        const text = formatSharelebratorPasswordText({
          name: customer.name,
          phone: customer.phone,
          tempPassword,
          resetAtMs: Date.now(),
          width: paperWidth,
        });
        await printViaNativeBluetooth({
          target: "pin",
          text,
          widthMm: paperWidth,
          cut: true,
          beep: true,
          encoding: "CP437",
        });
        toast({ title: "Printed", description: "Slip sent to thermal printer." });
      } catch (err: any) {
        toast({ title: "Print failed", description: err.message || "Unknown error", variant: "destructive" });
      }
      return;
    }

    // Web fallback → browser print via pop-up window
    const resetDate = format(new Date(), "MMM d, yyyy h:mm a");
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Sharelebrator Password Reset</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 380px; margin: 0 auto; color: #1a1a1a; }
    .brand { text-align: center; font-weight: 900; font-size: 20px; letter-spacing: 2px; margin-bottom: 4px; }
    .tagline { text-align: center; font-size: 11px; color: #666; margin-bottom: 24px; letter-spacing: 3px; text-transform: uppercase; }
    .section { margin-bottom: 16px; }
    .label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 2px; }
    .value { font-size: 15px; font-weight: 600; }
    .pw-box { border: 2px dashed #000; padding: 16px; text-align: center; margin: 20px 0; border-radius: 8px; }
    .pw-label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 8px; }
    .pw-value { font-family: 'Courier New', monospace; font-size: 28px; font-weight: 900; letter-spacing: 4px; }
    .footer { font-size: 10px; color: #666; text-align: center; margin-top: 24px; line-height: 1.5; border-top: 1px solid #ddd; padding-top: 12px; }
    .date { font-size: 10px; color: #999; text-align: center; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="brand">★ SHARELEBRATOR ★</div>
  <div class="tagline">Password Reset</div>
  <div class="section">
    <div class="label">Cardholder</div>
    <div class="value">${customer.name}</div>
  </div>
  <div class="section">
    <div class="label">Phone</div>
    <div class="value">${customer.phone}</div>
  </div>
  <div class="pw-box">
    <div class="pw-label">Temporary Password</div>
    <div class="pw-value">${tempPassword}</div>
  </div>
  <div class="footer">
    Use this password to log in to your Sharelebrator account.
    Please change your password after logging in for security.
  </div>
  <div class="date">Reset on ${resetDate}</div>
  <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); };</script>
</body>
</html>`;

    const w = window.open("", "_blank", "width=420,height=600");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the password.", variant: "destructive" });
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      {Dialog}

      {/* Side-by-side: Lookup | Cardholder */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Left: Lookup */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Sharelebrator Customer Lookup
            </CardTitle>
            <CardDescription>
              Search by phone number. Admins and managers can reset forgotten passwords.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label>Phone Number</Label>
                <Input
                  type="tel"
                  placeholder="09XXXXXXXXX or +63XXXXXXXXXX"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || !phoneInput.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-2">Search</span>
              </Button>
            </div>
            {notFound && (
              <p className="text-sm text-amber-700 mt-3">
                No Sharelebrator account found for that phone number.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Right: Cardholder details */}
        <Card>
          <CardContent className="p-6 h-full">
            {!customer ? (
              <div className="flex items-center justify-center h-full min-h-[140px] text-sm text-muted-foreground">
                No card to display
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Cardholder</p>
                    <p className="text-2xl font-bold">{customer.name}</p>
                    <p className="text-sm font-mono">{customer.phone}</p>
                    {customer.bday && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Birthday: {format(new Date(customer.bday), "MMMM d, yyyy")}
                      </p>
                    )}
                    {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                    <p className="text-xs text-muted-foreground">{customer.address}</p>
                    {customer.createdAtMs && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Member since {format(new Date(customer.createdAtMs), "MMM d, yyyy")}
                      </p>
                    )}
                    {customer.passwordResetAtMs && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        Password reset {format(new Date(customer.passwordResetAtMs), "MMM d, yyyy")}
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Balance</p>
                    <p className="text-3xl font-black text-foreground">{customer.pointsBalance.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">points</p>
                  </div>
                </div>

                {canReset && (
                  <div className="pt-4 border-t flex flex-col gap-2">
                    {tempPassword ? (
                      <div className="rounded-lg border-2 border-green-300 bg-green-50 p-3 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-semibold text-green-800">
                          <KeyRound className="h-4 w-4" /> Temporary password (share with customer)
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-lg font-bold bg-white px-3 py-1.5 rounded border flex-1">
                            {tempPassword}
                          </code>
                          <Button size="sm" variant="outline" onClick={copyPassword} title="Copy">
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={printPassword} title="Print">
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                        <p className="text-[11px] text-green-700">
                          This password is shown only once. The customer should change it after logging in.
                        </p>
                      </div>
                    ) : (
                      <Button variant="outline" onClick={handleResetPassword} disabled={resetting} className="w-full">
                        {resetting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
                        Reset Password
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Full-width transactions (only when a customer is loaded) */}
      {customer && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {ledger.length === 0 ? (
              <p className="px-6 py-8 text-sm text-center text-muted-foreground">No transactions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Type</TableHead>
                    <TableHead className="text-xs">Store</TableHead>
                    <TableHead className="text-xs text-right">Amount</TableHead>
                    <TableHead className="text-xs text-right">Points</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">
                        {e.createdAtMs ? format(new Date(e.createdAtMs), "MMM d, h:mma") : "—"}
                      </TableCell>
                      <TableCell className="text-xs capitalize">{e.type}</TableCell>
                      <TableCell className="text-xs font-mono">{e.storeId.substring(0, 6)}</TableCell>
                      <TableCell className="text-xs text-right font-mono">
                        ₱{e.amount.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className={`text-xs text-right font-mono font-bold ${
                          e.points > 0 ? "text-green-600" : e.points < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {e.points > 0 ? "+" : ""}
                        {e.points}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
