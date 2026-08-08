"use client";

import { useEffect, useRef } from "react";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { toJsDate } from "@/lib/utils/date";
import { actionLabel, describeActivityLog } from "@/lib/logs/describe-log";
import { actorLabel, type ActorNameMap } from "@/lib/session-timeline/actors";
import type { SessionAuditFlag, SessionTrailSources } from "@/lib/session-timeline/types";
import type { SessionDoc } from "@/lib/types";
import { ManagerReviewControl } from "./ManagerReviewControl";

/**
 * The line-by-line detail behind the stage sequence: bill lines, kitchen
 * tickets, guest devices, the raw activity log, and the manager review control.
 * All collapsed by default — the stages answer most questions, and this is for
 * the ones they don't.
 */

const fmtTime = (v: any) => {
  const d = toJsDate(v);
  return d ? format(d, "h:mm:ss a") : "—";
};

const peso = (n: unknown) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(n) || 0);

function Section({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number | string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border rounded-lg">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-between h-9 px-3 text-sm font-medium group"
        >
          <span className="flex items-center gap-2">
            {title}
            {count !== undefined && count !== 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{count}</Badge>
            )}
          </span>
          <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-1 overflow-x-auto">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AuditTail({
  storeId,
  sources,
  nameMaps,
  focusId,
  onFlagSaved,
}: {
  storeId: string;
  sources: SessionTrailSources;
  nameMaps: ActorNameMap[];
  focusId?: string | null;
  onFlagSaved?: (next: SessionAuditFlag) => void;
}) {
  const focusRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [focusId]);

  const { billLines, tickets, participants, activityLogs, session, flag, sessionId } = sources;

  return (
    <div className="grid gap-2 mt-4">
      {billLines.length > 0 && (
        <Section title="Bill lines" count={billLines.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Free</TableHead>
                <TableHead className="text-right">Voided</TableHead>
                <TableHead className="text-right">Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billLines.map((line) => {
                const l = line as any;
                return (
                  <TableRow key={line.id}>
                    <TableCell>
                      <span>{l.itemName}</span>
                      {l.modifiersText && (
                        <span className="block text-xs text-muted-foreground">{l.modifiersText}</span>
                      )}
                      <span className="block text-xs text-muted-foreground">{l.type}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.qtyOrdered ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.freeQty || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.voidedQty || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{peso(l.unitPrice)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}

      {tickets.length > 0 && (
        <Section title="Kitchen tickets" count={tickets.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets.map((ticket) => {
                const t = ticket as any;
                return (
                  <TableRow key={ticket.id}>
                    <TableCell>{t.itemName ?? ticket.id}</TableCell>
                    <TableCell className="text-muted-foreground">{t.type}</TableCell>
                    <TableCell>
                      <Badge variant={t.status === "cancelled" ? "destructive" : "secondary"}>{t.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.qtyOrdered ?? t.qty ?? 1}</TableCell>
                    <TableCell className="text-muted-foreground">{t.cancelReason ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}

      {participants.length > 0 && (
        <Section title="Guest devices" count={participants.length}>
          <ul className="text-sm grid gap-1">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <span>
                  Guest {p.slotNumber ?? "?"} — {p.joinMethod === "qr" ? "QR scan" : "Manual PIN"}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {p.joinedAtMs ? format(new Date(p.joinedAtMs), "h:mm a") : "—"}
                  <Badge
                    variant={p.status === "revoked" ? "destructive" : "secondary"}
                    className="ml-2 h-4 px-1.5 text-[10px]"
                  >
                    {p.status ?? "active"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {activityLogs.length > 0 && (
        <Section
          title="Activity log"
          count={activityLogs.length}
          // A deep link points at one specific event, so open straight to it.
          defaultOpen={!!focusId}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Time</TableHead>
                <TableHead className="w-[140px]">Action</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="w-[140px]">Who</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityLogs.map((log) => {
                const described = describeActivityLog(log);
                const actor = actorLabel(log.actorUid, nameMaps, log.serverProfileName || log.actorName);
                const focused = !!focusId && log.id === focusId;
                return (
                  <TableRow
                    key={log.id}
                    ref={focused ? focusRef : undefined}
                    className={cn(focused && "ring-2 ring-primary bg-primary/5")}
                  >
                    <TableCell className="tabular-nums whitespace-nowrap">{fmtTime(log.createdAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{actionLabel(log.action)}</TableCell>
                    <TableCell>
                      <span>{described.title}</span>
                      {described.detail && (
                        <span className="block text-xs text-muted-foreground">{described.detail}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn("whitespace-nowrap", !actor.resolved && "text-muted-foreground font-mono text-xs")}
                      title={actor.resolved ? undefined : actor.uid ?? undefined}
                    >
                      {actor.name}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}

      {sessionId && (
        <Section title="Manager review" defaultOpen={flag?.status === "flagged"}>
          <ManagerReviewControl
            storeId={storeId}
            sessionId={sessionId}
            session={session as SessionDoc | null}
            flag={flag}
            onSaved={onFlagSaved}
          />
        </Section>
      )}
    </div>
  );
}
