"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit as qLimit } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, KeyRound, Copy, Printer, Sparkles, Users, Coins, ScrollText, KeyRound as KeyIcon, UserPlus, Coins as CoinIcon, MapPin } from "lucide-react";
import { format } from "date-fns";
import { isNativeBluetoothAvailable, getLastPrinterAddress, printViaNativeBluetooth } from "@/lib/printing/printHub";
import { formatSharelebratorPasswordText } from "@/lib/printing/receiptFormatter";

type LedgerEntry = {
  id: string;
  type: "earn" | "redeem" | "adjust";
  points: number;
  amount: number;
  storeId: string;
  storeName?: string;
  sessionId: string;
  createdAtMs: number | null;
};

type StoreVisit = { visits: number; pointsEarned: number; lastVisitAtMs: number; storeName?: string };

type Customer = {
  phone: string;
  name: string;
  visitCount?: number;
  storeVisits?: Record<string, StoreVisit>;
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

  // All accounts (live subscription)
  const [allAccounts, setAllAccounts] = useState<
    { phone: string; name: string; pointsBalance: number; createdAtMs: number | null }[]
  >([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // Audit logs (live subscription)
  const [logs, setLogs] = useState<
    Array<{
      id: string;
      type: "account_created" | "points_earned" | "password_reset";
      phone: string;
      customerName: string;
      actorUid: string;
      storeId?: string;
      storeName?: string;
      points?: number;
      amount?: number;
      createdAtMs: number | null;
    }>
  >([]);
  const [logsLoading, setLogsLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "loyaltyLogs"), orderBy("createdAt", "desc"), qLimit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            type: data.type,
            phone: data.phone ?? "",
            customerName: data.customerName ?? "",
            actorUid: data.actorUid ?? "",
            storeId: data.storeId ?? undefined,
            storeName: data.storeName ?? undefined,
            points: data.points ?? undefined,
            amount: data.amount ?? undefined,
            createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
          };
        });
        setLogs(rows);
        setLogsLoading(false);
      },
      (err) => {
        console.error("Failed to fetch loyalty logs:", err);
        setLogsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "customers"), orderBy("createdAt", "desc"), qLimit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            phone: d.id,
            name: data.name ?? "",
            pointsBalance: data.pointsBalance ?? 0,
            createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : null,
          };
        });
        setAllAccounts(rows);
        setAccountsLoading(false);
      },
      (err) => {
        console.error("Failed to fetch accounts:", err);
        setAccountsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const totalPointsOutstanding = useMemo(
    () => allAccounts.reduce((sum, a) => sum + (a.pointsBalance || 0), 0),
    [allAccounts]
  );

  // Accounts filter — only show results when user has typed a query
  const accountQuery = phoneInput.trim().toLowerCase();
  const filteredAccounts = useMemo(() => {
    if (!accountQuery) return [];
    return allAccounts.filter(
      (a) => a.phone.toLowerCase().includes(accountQuery) || a.name.toLowerCase().includes(accountQuery)
    );
  }, [allAccounts, accountQuery]);

  // Pagination state
  const ACCOUNTS_PAGE_SIZE = 10;
  const TRANSACTIONS_PAGE_SIZE = 10;
  const LOGS_PAGE_SIZE = 20;
  const [accountsPage, setAccountsPage] = useState(0);
  const [txnsPage, setTxnsPage] = useState(0);
  const [logsPage, setLogsPage] = useState(0);

  // Reset to first page when data or filter changes
  useEffect(() => {
    setAccountsPage(0);
  }, [accountQuery]);
  useEffect(() => {
    setTxnsPage(0);
  }, [customer?.phone]);
  // Clamp pages if total shrinks underneath the user
  useEffect(() => {
    setLogsPage((p) => Math.min(p, Math.max(0, Math.ceil(logs.length / LOGS_PAGE_SIZE) - 1)));
  }, [logs.length]);
  useEffect(() => {
    setAccountsPage((p) => Math.min(p, Math.max(0, Math.ceil(filteredAccounts.length / ACCOUNTS_PAGE_SIZE) - 1)));
  }, [filteredAccounts.length]);
  useEffect(() => {
    setTxnsPage((p) => Math.min(p, Math.max(0, Math.ceil(ledger.length / TRANSACTIONS_PAGE_SIZE) - 1)));
  }, [ledger.length]);

  const accountsTotalPages = Math.max(1, Math.ceil(filteredAccounts.length / ACCOUNTS_PAGE_SIZE));
  const txnsTotalPages = Math.max(1, Math.ceil(ledger.length / TRANSACTIONS_PAGE_SIZE));
  const logsTotalPages = Math.max(1, Math.ceil(logs.length / LOGS_PAGE_SIZE));

  const accountsPageRows = useMemo(
    () => filteredAccounts.slice(accountsPage * ACCOUNTS_PAGE_SIZE, (accountsPage + 1) * ACCOUNTS_PAGE_SIZE),
    [filteredAccounts, accountsPage]
  );
  const txnsPageRows = useMemo(
    () => ledger.slice(txnsPage * TRANSACTIONS_PAGE_SIZE, (txnsPage + 1) * TRANSACTIONS_PAGE_SIZE),
    [ledger, txnsPage]
  );
  const logsPageRows = useMemo(
    () => logs.slice(logsPage * LOGS_PAGE_SIZE, (logsPage + 1) * LOGS_PAGE_SIZE),
    [logs, logsPage]
  );

  const canReset =
    appUser?.role === "admin" || appUser?.role === "manager" || appUser?.isPlatformAdmin;

  function handlePickAccount(phone: string) {
    setPhoneInput(phone);
    // Pass phone directly so we don't race the React state update.
    searchByPhone(phone);
  }

  async function searchByPhone(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || !user) return;
    setLoading(true);
    setNotFound(false);
    setCustomer(null);
    setLedger([]);
    setTempPassword(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/loyalty/lookup?phone=${encodeURIComponent(trimmed)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Lookup failed.");
      if (!json.found) setNotFound(true);
      else {
        setCustomer(json.customer);
        setLedger(json.ledger || []);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    return searchByPhone(phoneInput);
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

      <div className="grid gap-4 lg:grid-cols-2 items-start">
      {/* LEFT COLUMN WRAPPER — will hold Cardholder+Transactions on top and All Accounts below */}
      <div className="space-y-4 lg:order-1">

      {/* Cardholder details + Recent transactions (single card) */}
      <Card>
        <CardContent className="p-6 h-full">
          {!customer ? (
            <div className="flex items-center justify-center min-h-[160px] text-sm text-muted-foreground">
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
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Visits: <span className="font-bold text-foreground">{customer.visitCount ?? 0}</span>
                  </p>
                </div>
              </div>

              {/* Stores visited */}
              {customer.storeVisits && Object.keys(customer.storeVisits).length > 0 && (
                <div className="pt-3 border-t">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-2">
                    <MapPin className="h-3 w-3" /> Stores Visited
                  </p>
                  <div className="space-y-1">
                    {Object.entries(customer.storeVisits)
                      .sort((a, b) => b[1].visits - a[1].visits)
                      .map(([sid, v]) => (
                        <div key={sid} className="flex items-center justify-between text-xs">
                          <span className="font-medium">{v.storeName || sid}</span>
                          <span className="text-muted-foreground">
                            {v.visits} visit{v.visits === 1 ? "" : "s"} · +{v.pointsEarned} pts
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

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

              {/* Recent transactions (inside same card) */}
              <div className="pt-4 border-t">
                <p className="text-sm font-semibold mb-2">Recent Transactions</p>
                {ledger.length === 0 ? (
                  <p className="py-4 text-sm text-center text-muted-foreground">No transactions yet.</p>
                ) : (
                  <>
                    <div className="border rounded-lg overflow-hidden">
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
                          {txnsPageRows.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs">
                                {e.createdAtMs ? format(new Date(e.createdAtMs), "MMM d, h:mma") : "—"}
                              </TableCell>
                              <TableCell className="text-xs capitalize">{e.type}</TableCell>
                              <TableCell className="text-xs">{e.storeName || e.storeId.substring(0, 8)}</TableCell>
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
                    </div>
                    {txnsTotalPages > 1 && (
                      <div className="flex items-center justify-between mt-2 text-xs">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTxnsPage((p) => Math.max(0, p - 1))}
                          disabled={txnsPage === 0}
                        >
                          Prev
                        </Button>
                        <span className="text-muted-foreground">
                          Page {txnsPage + 1} of {txnsTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTxnsPage((p) => Math.min(txnsTotalPages - 1, p + 1))}
                          disabled={txnsPage >= txnsTotalPages - 1}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
      {/* END LEFT COLUMN */}

      {/* RIGHT COLUMN: All Accounts + Activity Log */}
      <div className="space-y-4 lg:order-2">
        {/* Accounts — with built-in search */}
        <Card>
          <CardHeader className="pb-3 space-y-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                All Accounts
              </CardTitle>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Accounts</p>
                  <p className="text-xl font-black">{allAccounts.length.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 justify-end">
                    <Coins className="h-3 w-3" /> Points out
                  </p>
                  <p className="text-xl font-black">{totalPointsOutstanding.toLocaleString()}</p>
                </div>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone..."
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {accountsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : !accountQuery ? (
              <p className="px-6 py-8 text-sm text-center text-muted-foreground">
                Type a name or phone above to search.
              </p>
            ) : filteredAccounts.length === 0 ? (
              <p className="px-6 py-8 text-sm text-center text-muted-foreground">
                No accounts match.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Phone</TableHead>
                      <TableHead className="text-xs text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountsPageRows.map((a) => (
                      <TableRow
                        key={a.phone}
                        className={`cursor-pointer hover:bg-muted/50 ${
                          customer?.phone === a.phone ? "bg-muted/70" : ""
                        }`}
                        onClick={() => handlePickAccount(a.phone)}
                      >
                        <TableCell className="text-sm font-medium">{a.name || "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{a.phone}</TableCell>
                        <TableCell className="text-sm text-right font-mono font-bold">
                          {a.pointsBalance.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {accountsTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t text-xs">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAccountsPage((p) => Math.max(0, p - 1))}
                      disabled={accountsPage === 0}
                    >
                      Prev
                    </Button>
                    <span className="text-muted-foreground">
                      Page {accountsPage + 1} of {accountsTotalPages} · {filteredAccounts.length} matches
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAccountsPage((p) => Math.min(accountsTotalPages - 1, p + 1))}
                      disabled={accountsPage >= accountsTotalPages - 1}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
        {/* Logs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              Activity Log
            </CardTitle>
            <CardDescription>
              Account creations, points earned, and password resets across all stores.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <p className="px-6 py-8 text-sm text-center text-muted-foreground">
                No activity yet.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">When</TableHead>
                      <TableHead className="text-xs">Event</TableHead>
                      <TableHead className="text-xs">Customer</TableHead>
                      <TableHead className="text-xs">Store</TableHead>
                      <TableHead className="text-xs text-right">Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logsPageRows.map((log) => {
                      const icon =
                        log.type === "account_created" ? (
                          <UserPlus className="h-3 w-3 text-blue-600" />
                        ) : log.type === "password_reset" ? (
                          <KeyIcon className="h-3 w-3 text-red-600" />
                        ) : (
                          <CoinIcon className="h-3 w-3 text-green-600" />
                        );
                      const label =
                        log.type === "account_created"
                          ? "New account"
                          : log.type === "password_reset"
                            ? "Password reset"
                            : "Earned";
                      return (
                        <TableRow
                          key={log.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handlePickAccount(log.phone)}
                        >
                          <TableCell className="text-xs text-muted-foreground">
                            {log.createdAtMs ? format(new Date(log.createdAtMs), "MMM d, h:mma") : "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="inline-flex items-center gap-1">
                              {icon}
                              {label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs truncate max-w-[120px]">
                            {log.customerName || log.phone}
                          </TableCell>
                          <TableCell className="text-xs truncate max-w-[100px]">
                            {log.storeName || (log.storeId ? log.storeId.substring(0, 8) : "—")}
                          </TableCell>
                          <TableCell className="text-xs text-right font-mono">
                            {log.type === "points_earned" ? (
                              <span className="text-green-600 font-bold">+{log.points}</span>
                            ) : log.type === "password_reset" ? (
                              <span className="text-red-600">reset</span>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {logsTotalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-2 border-t text-xs">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLogsPage((p) => Math.max(0, p - 1))}
                      disabled={logsPage === 0}
                    >
                      Prev
                    </Button>
                    <span className="text-muted-foreground">
                      Page {logsPage + 1} of {logsTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setLogsPage((p) => Math.min(logsTotalPages - 1, p + 1))}
                      disabled={logsPage >= logsTotalPages - 1}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
