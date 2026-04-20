"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  FileText,
  Flag,
  Loader2,
  Scissors,
  Tag,
  Utensils,
} from "lucide-react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";
import { computeSessionLabel } from "@/lib/utils/session";
import { toJsDate } from "@/lib/utils/date";
import { writeActivityLog } from "@/components/cashier/activity-log";
import { useSessionAuditTrail, type SessionAuditEvent, type SessionAuditFlag } from "@/hooks/useSessionAuditTrail";

function fmtDate(value: any) {
  const d = toJsDate(value) ?? (value instanceof Date ? value : null);
  return d ? format(d, "MMM d, yyyy h:mm:ss a") : "N/A";
}

function fmtMoney(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `PHP ${n.toFixed(2)}` : "N/A";
}

function eventIcon(type: SessionAuditEvent["type"]) {
  switch (type) {
    case "void":
      return <Scissors className="h-4 w-4" />;
    case "discount":
    case "free":
      return <Tag className="h-4 w-4" />;
    case "kitchen":
      return <Utensils className="h-4 w-4" />;
    case "payment":
      return <CreditCard className="h-4 w-4" />;
    case "flag":
      return <Flag className="h-4 w-4" />;
    default:
      return <FileText className="h-4 w-4" />;
  }
}

function eventBadgeClass(type: SessionAuditEvent["type"]) {
  switch (type) {
    case "void":
      return "border-red-300 bg-red-50 text-red-700";
    case "discount":
      return "border-amber-300 bg-amber-50 text-amber-700";
    case "free":
      return "border-green-300 bg-green-50 text-green-700";
    case "payment":
      return "border-blue-300 bg-blue-50 text-blue-700";
    case "flag":
      return "border-violet-300 bg-violet-50 text-violet-700";
    default:
      return "";
  }
}

function riskTotal(risk: ReturnType<typeof useSessionAuditTrail>["riskSummary"]) {
  return risk.voids + risk.discounts + risk.freeItems + risk.receiptEdits + risk.kitchenCancels + risk.guestChanges + risk.packageChanges + risk.priceOverrides;
}

export default function SessionAuditPage() {
  const params = useParams<{ storeId: string; sessionId: string }>();
  const searchParams = useSearchParams();
  const storeId = decodeURIComponent(params.storeId);
  const sessionId = decodeURIComponent(params.sessionId);
  const focusId = searchParams.get("focus");
  const { appUser } = useAuthContext();
  const {
    session,
    receipt,
    billLines,
    tickets,
    activityLogs,
    flag,
    events,
    riskSummary,
    loading,
    error,
  } = useSessionAuditTrail(storeId, sessionId);

  const [severity, setSeverity] = useState<SessionAuditFlag["severity"]>("medium");
  const [reason, setReason] = useState("");
  const [savingFlag, setSavingFlag] = useState(false);

  const canManageFlag = appUser?.isPlatformAdmin === true || appUser?.role === "admin" || appUser?.role === "manager";
  const sessionLabel = session ? computeSessionLabel(session) : sessionId.slice(0, 8);
  const isFlagged = flag?.status === "flagged";

  const financial = useMemo(() => {
    const analytics = receipt?.analytics ?? {};
    return {
      subtotal: analytics.subtotal,
      discounts: analytics.discountsTotal ?? receipt?.discountsTotal,
      charges: analytics.chargesTotal,
      tax: analytics.taxAmount,
      total: receipt?.total ?? analytics.grandTotal,
      paid: receipt?.totalPaid ?? analytics.totalPaid,
      change: receipt?.change ?? analytics.change,
      mop: analytics.mop ?? {},
    };
  }, [receipt]);

  const handleFlagSave = async (status: "flagged" | "cleared") => {
    if (!appUser || !canManageFlag) return;
    setSavingFlag(true);
    try {
      const flagRef = doc(db, "stores", storeId, "sessionAuditFlags", sessionId);
      const patch: SessionAuditFlag = {
        sessionId,
        storeId,
        status,
        severity,
        reason: status === "flagged" ? reason.trim() || null : flag?.reason ?? null,
        notes: status === "flagged" ? reason.trim() || null : flag?.notes ?? null,
        flaggedByUid: status === "flagged" ? appUser.uid : flag?.flaggedByUid ?? null,
        flaggedByName: status === "flagged" ? appUser.displayName || appUser.name || appUser.email || null : flag?.flaggedByName ?? null,
        flaggedAt: status === "flagged" ? serverTimestamp() : flag?.flaggedAt ?? null,
        clearedByUid: status === "cleared" ? appUser.uid : null,
        clearedByName: status === "cleared" ? appUser.displayName || appUser.name || appUser.email || null : null,
        clearedAt: status === "cleared" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };
      await setDoc(flagRef, patch, { merge: true });
      await writeActivityLog({
        storeId,
        sessionId,
        user: appUser,
        action: status === "flagged" ? "SESSION_AUDIT_FLAGGED" : "SESSION_AUDIT_CLEARED",
        reason: status === "flagged" ? reason.trim() || "Flagged for review" : "Audit flag cleared",
        sessionContext: {
          sessionStatus: session?.status,
          sessionStartedAt: session?.startedAt,
          sessionMode: session?.sessionMode,
          customerName: session?.customerName ?? session?.customer?.name,
          tableNumber: session?.tableNumber,
          tableDisplayName: session?.tableDisplayName,
        },
        meta: { severity, sessionLabel },
      });
      if (status === "cleared") setReason("");
    } finally {
      setSavingFlag(false);
    }
  };

  if (loading) {
    return (
      <RoleGuard allow={["admin", "manager", "cashier"]}>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </RoleGuard>
    );
  }

  if (error) {
    return (
      <RoleGuard allow={["admin", "manager", "cashier"]}>
        <Card>
          <CardHeader>
            <CardTitle>Could not load session audit</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
        </Card>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <PageHeader title="Session Audit" description={sessionLabel}>
        <div className="flex items-center gap-2">
          {isFlagged && <Badge className="bg-red-600">Flagged</Badge>}
          <Button asChild variant="outline" size="sm">
            <Link href="/logs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Logs
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Lifecycle Timeline</CardTitle>
              <CardDescription>Complete event trail from session start to closure and manager review.</CardDescription>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No session events found.</p>
              ) : (
                <div className="space-y-0">
                  {events.map((event) => {
                    const focused = focusId && event.id === focusId;
                    return (
                      <div key={`${event.source}-${event.id}`} className="relative grid grid-cols-[140px_1fr] gap-4 border-l pl-5 py-3">
                        <div className="absolute -left-[7px] top-5 h-3 w-3 rounded-full border-2 border-primary bg-background" />
                        <div className="text-xs text-muted-foreground">{format(event.timestamp, "h:mm:ss a")}</div>
                        <div className={`rounded-md border p-3 ${focused ? "border-primary bg-primary/5" : "bg-background"}`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={eventBadgeClass(event.type)}>
                                  <span className="mr-1">{eventIcon(event.type)}</span>
                                  {event.type}
                                </Badge>
                                <p className="font-medium">{event.title}</p>
                              </div>
                              {event.detail && <p className="mt-1 text-sm text-muted-foreground">{event.detail}</p>}
                            </div>
                            {event.amount != null && <span className="font-mono text-sm">{fmtMoney(event.amount)}</span>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{fmtDate(event.timestamp)}</span>
                            {(event.actorName || event.actorUid) && <span>Actor: {event.actorName || event.actorUid}</span>}
                            <span>Source: {event.source}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Bill Lines</CardTitle>
              <CardDescription>Final bill state with void, free, and discount markers.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Free</TableHead>
                    <TableHead className="text-right">Voided</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium">{line.itemName}</div>
                        <div className="text-xs text-muted-foreground">{line.type}</div>
                      </TableCell>
                      <TableCell className="text-right">{line.qtyOrdered}</TableCell>
                      <TableCell className="text-right">{line.freeQty || 0}</TableCell>
                      <TableCell className="text-right">{line.voidedQty || 0}</TableCell>
                      <TableCell className="text-right">
                        {line.discountValue ? `${line.discountValue}${line.discountType === "percent" ? "%" : ""} x ${line.discountQty}` : "N/A"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmtMoney(line.unitPrice)}</TableCell>
                    </TableRow>
                  ))}
                  {billLines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">No bill lines found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kitchen Tickets</CardTitle>
              <CardDescription>Ticket lifecycle for kitchen-originated fulfilment and cancellations.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>{(ticket as any).itemName || ticket.id}</TableCell>
                      <TableCell><Badge variant={(ticket as any).status === "cancelled" ? "destructive" : "secondary"}>{(ticket as any).status || "unknown"}</Badge></TableCell>
                      <TableCell className="text-right">{(ticket as any).qtyOrdered ?? (ticket as any).qty ?? 1}</TableCell>
                      <TableCell>{(ticket as any).cancelReason || "N/A"}</TableCell>
                    </TableRow>
                  ))}
                  {tickets.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">No kitchen tickets found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Session Summary</CardTitle>
              <CardDescription>{session?.status || "Unknown"} session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Session</span><span className="font-mono">{sessionId.slice(0, 8)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Started</span><span>{fmtDate(session?.startedAt ?? session?.startedAtClientMs)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Closed</span><span>{fmtDate(session?.closedAt ?? session?.closedAtClientMs ?? receipt?.createdAt)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Mode</span><span>{session?.sessionMode || receipt?.sessionMode || "N/A"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Guests</span><span>{session?.guestCountFinal ?? session?.guestCountCashierInitial ?? "N/A"}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Receipt</span><span>{receipt?.receiptNumber || "N/A"}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Financial Summary</CardTitle>
              <CardDescription>Receipt totals and payment breakdown.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-mono">{fmtMoney(financial.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Discounts</span><span className="font-mono">{fmtMoney(financial.discounts)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Charges</span><span className="font-mono">{fmtMoney(financial.charges)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-mono">{fmtMoney(financial.tax)}</span></div>
              <div className="flex justify-between border-t pt-3 font-semibold"><span>Total</span><span className="font-mono">{fmtMoney(financial.total)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="font-mono">{fmtMoney(financial.paid)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Change</span><span className="font-mono">{fmtMoney(financial.change)}</span></div>
              {Object.entries(financial.mop).map(([method, amount]) => (
                <div key={method} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{method}</span>
                  <span className="font-mono">{fmtMoney(amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk Markers</CardTitle>
              <CardDescription>{riskTotal(riskSummary)} audit-relevant events detected.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(riskSummary).map(([key, value]) => (
                <div key={key} className="rounded-md border p-3">
                  <div className="text-xl font-semibold">{value}</div>
                  <div className="text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {isFlagged ? <AlertTriangle className="h-5 w-5 text-red-600" /> : <CheckCircle2 className="h-5 w-5 text-green-600" />}
                Manager Review
              </CardTitle>
              <CardDescription>{isFlagged ? `Flagged as ${flag?.severity || "medium"} severity.` : "No active manager flag."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {flag?.reason && <p className="rounded-md border bg-muted p-3 text-sm">{flag.reason}</p>}
              {canManageFlag ? (
                <>
                  <div className="space-y-2">
                    <Label>Severity</Label>
                    <Select value={severity} onValueChange={(value) => setSeverity(value as SessionAuditFlag["severity"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason / Notes</Label>
                    <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why should this session be reviewed?" />
                  </div>
                  <div className="flex gap-2">
                    <Button disabled={savingFlag} onClick={() => handleFlagSave("flagged")} className="flex-1">
                      {savingFlag ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Flag className="mr-2 h-4 w-4" />}
                      Flag
                    </Button>
                    <Button disabled={savingFlag || !isFlagged} onClick={() => handleFlagSave("cleared")} variant="outline" className="flex-1">
                      Clear
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Only managers and admins can flag or clear session reviews.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Raw Activity Logs</CardTitle>
              <CardDescription>{activityLogs.length} entries in the session log collection.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {activityLogs.slice(0, 20).map((log) => (
                <div key={log.id} className="rounded-md border p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{log.action}</span>
                    <span className="text-muted-foreground">{fmtDate(log.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{log.note || log.reason || log.actorName || "No note"}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </RoleGuard>
  );
}
