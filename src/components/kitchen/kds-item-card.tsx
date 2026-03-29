"use client";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, XCircle, Info, Send, ChevronDown, ChevronUp } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirmDialog } from "../global/confirm-dialog";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import type { KitchenTicket } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { cleanupRadixOverlays } from "@/lib/ui/cleanup-radix";

function formatDuration(ms: number): string {
    if (isNaN(ms) || ms < 0) return "00:00:00";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(n => n.toString().padStart(2, '0')).join(':');
}

function getStartMs(input: any): number | null {
  if (!input) return null;
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (input instanceof Date) { const t = input.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof input.toMillis === "function") return input.toMillis();
  if (typeof input.seconds === "number") {
    const ns = typeof input.nanoseconds === "number" ? input.nanoseconds : 0;
    return input.seconds * 1000 + Math.floor(ns / 1e6);
  }
  return null;
}

function TimeLapse({ createdAt, createdAtClientMs }: { createdAt: any; createdAtClientMs?: number | null }) {
  const startMs = useMemo(() => {
    return Number.isFinite(createdAtClientMs as number) ? (createdAtClientMs as number) : getStartMs(createdAt);
  }, [createdAt, createdAtClientMs]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!Number.isFinite(startMs as number)) return;
    const timerId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, [startMs]);
  const elapsedMs = Math.max(0, now - (startMs as number));
  const totalMinutes = Math.floor(elapsedMs / 60000);
  return (
    <div className={cn("flex items-center gap-1.5 text-base font-mono", totalMinutes >= 10 ? "text-destructive font-semibold" : "text-amber-600")}>
      <Clock size={14} />
      <span>{Number.isFinite(startMs as number) ? formatDuration(elapsedMs) : "00:00:00"}</span>
    </div>
  );
}

const CANCELLATION_REASONS = ["Out of stock", "Customer request", "Incorrect order"];

export interface ServeBatchPayload {
  ticketId: string;
  sessionId: string;
  qtyToServe: number;
}

export interface CancelRemainingPayload {
  ticketId: string;
  sessionId: string;
  reason: string;
}

interface KdsItemCardProps {
    ticket: KitchenTicket;
    onUpdateStatus: (ticketId: string, sessionId: string, newStatus: "served" | "cancelled", reason?: string) => void;
    onServeBatch?: (payload: ServeBatchPayload) => void;
    onCancelRemaining?: (payload: CancelRemainingPayload) => void;
}

export function KdsItemCard({ ticket, onUpdateStatus, onServeBatch, onCancelRemaining }: KdsItemCardProps) {
    const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
    const [serveBatchOpen, setServeBatchOpen] = useState(false);
    const [serveQtyInput, setServeQtyInput] = useState("1");
    const [showServeLog, setShowServeLog] = useState(false);

    const isBatchTicket = ticket.qtyOrdered != null && ticket.qtyOrdered > 1;
    const qtyOrdered = ticket.qtyOrdered ?? ticket.qty ?? 1;
    const qtyServed = ticket.qtyServed ?? 0;
    const qtyCancelled = ticket.qtyCancelled ?? 0;
    const qtyRemaining = ticket.qtyRemaining ?? (qtyOrdered - qtyServed - qtyCancelled);
    const serveLog = ticket.serveLog ?? [];

    const isAlaCarte = ticket.sessionMode === 'alacarte';
    const isPackage = ticket.type === 'package';
    const identifier = isAlaCarte
        ? (ticket.sessionLabel ?? (ticket.customerName || "Ala Carte"))
        : ((ticket as any).tableDisplayName || ticket.sessionLabel || `Table ${ticket.tableNumber}`);

    const handleCancel = async (reason: string) => {
        if (!reason) return;
        const confirmed = await confirm({
            title: `Cancel Item: ${ticket.itemName}?`,
            description: `Reason: ${reason}. This cannot be undone.`,
            confirmText: "Yes, Cancel Item",
            destructive: true,
        });
        cleanupRadixOverlays();
        if (confirmed) onUpdateStatus(ticket.id, ticket.sessionId, "cancelled", reason);
    };

    const handleCancelRemaining = async (reason: string) => {
        if (!reason) return;
        const confirmed = await confirm({
            title: `Cancel remaining ${qtyRemaining} of ${ticket.itemName}?`,
            description: `Reason: ${reason}. ${qtyServed} already served will remain served.`,
            confirmText: "Yes, Cancel Remaining",
            destructive: true,
        });
        cleanupRadixOverlays();
        if (confirmed) {
            if (onCancelRemaining) onCancelRemaining({ ticketId: ticket.id, sessionId: ticket.sessionId, reason });
            else onUpdateStatus(ticket.id, ticket.sessionId, "cancelled", reason);
        }
    };

    const handleServeBatchConfirm = () => {
        const qty = parseInt(serveQtyInput, 10);
        if (isNaN(qty) || qty <= 0 || qty > qtyRemaining) return;
        if (onServeBatch) onServeBatch({ ticketId: ticket.id, sessionId: ticket.sessionId, qtyToServe: qty });
        setServeBatchOpen(false);
        setServeQtyInput("1");
    };

    const openServeBatch = () => {
        setServeQtyInput(String(qtyRemaining));
        setServeBatchOpen(true);
    };

    const statusColor = ticket.status === 'served'
        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        : ticket.status === 'cancelled'
        ? 'bg-gray-50 dark:bg-gray-900/20 border-gray-200'
        : '';

    return (
        <>
            <Card className={cn("flex flex-col", statusColor)}>
                <CardHeader className="p-3">
                    <div className="flex justify-between items-center gap-2">
                        <p className="text-2xl font-bold text-destructive">{identifier}</p>
                        <TimeLapse createdAt={ticket.createdAt} createdAtClientMs={ticket.createdAtClientMs ?? null} />
                    </div>
                    <CardTitle className="text-xl">{ticket.itemName}</CardTitle>

                    {/* Qty progress for batch tickets */}
                    {isBatchTicket && (
                        <div className="mt-1 space-y-1">
                            <div className="flex gap-3 text-sm flex-wrap">
                                <span className="font-semibold">Ordered: <span className="text-foreground">{qtyOrdered}</span></span>
                                <span className="text-green-700 font-semibold">Served: {qtyServed}</span>
                                {qtyCancelled > 0 && <span className="text-destructive font-semibold">Cancelled: {qtyCancelled}</span>}
                                {qtyRemaining > 0 && <span className="text-amber-600 font-semibold">Remaining: {qtyRemaining}</span>}
                            </div>
                            <div className="w-full h-2 bg-muted rounded-full overflow-hidden flex">
                                <div className="bg-green-500 h-full transition-all" style={{ width: `${(qtyServed/qtyOrdered)*100}%` }} />
                                <div className="bg-destructive h-full transition-all" style={{ width: `${(qtyCancelled/qtyOrdered)*100}%` }} />
                            </div>
                        </div>
                    )}
                </CardHeader>

                <CardContent className="flex-grow space-y-2 p-3 pt-0">
                    {ticket.type === 'refill' && (ticket as any).refillRequest && (
                        <div className="space-y-1">
                            {Object.entries((ticket as any).refillRequest as Record<string, any>)
                              .filter(([, v]) => Number(v || 0) > 0)
                              .map(([k, v]) => (
                                <p key={k} className="text-lg font-semibold">{String(k).replace(/_/g, " ")} {Number(v)}</p>
                              ))}
                        </div>
                    )}
                    {ticket.initialFlavorNames && ticket.initialFlavorNames.length > 0 && (
                        <div className="text-base flex items-baseline gap-2 flex-wrap">
                            <span className="font-semibold">Flavors:</span>
                            {ticket.initialFlavorNames.map(name => <Badge key={name} variant="secondary" className="text-base">{name}</Badge>)}
                        </div>
                    )}
                    {ticket.notes && (
                        <div className="text-sm p-2 bg-yellow-50 border border-yellow-200 rounded-md dark:bg-yellow-900/20 dark:border-yellow-800">
                            <p className="font-semibold flex items-center gap-1"><Info size={14}/> Notes:</p>
                            <p className="text-muted-foreground pl-2">{ticket.notes}</p>
                        </div>
                    )}

                    {/* Serve log */}
                    {serveLog.length > 0 && (
                        <div>
                            <button onClick={() => setShowServeLog(v => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                                {showServeLog ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                                Serve log ({serveLog.length} batch{serveLog.length > 1 ? 'es' : ''})
                            </button>
                            {showServeLog && (
                                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground border rounded p-2">
                                    {serveLog.map((log, i) => (
                                        <div key={i} className="flex justify-between">
                                            <span>Batch {i+1}: <strong className="text-green-700">{log.qty} served</strong></span>
                                            <span>{log.servedAtClientMs ? format(new Date(log.servedAtClientMs), 'HH:mm:ss') : ''}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex justify-between items-center gap-2 p-3 pt-2 flex-wrap">
                    <div>
                        {ticket.status === 'served' ? (
                            <Badge variant="default" className="bg-green-600 whitespace-nowrap text-sm"><CheckCircle className="mr-1" />Served</Badge>
                        ) : ticket.status === 'cancelled' ? (
                            <Badge variant="destructive" className="text-sm">Cancelled</Badge>
                        ) : (
                            <Badge variant="outline" className="capitalize text-sm">{ticket.status}</Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        {(ticket.status === 'preparing' || ticket.status === 'partially_served') && (
                            <>
                                {/* Cancel — full cancel or cancel remaining */}
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="destructive" size="sm">
                                            <XCircle className="mr-2" /> {qtyServed > 0 ? 'Cancel Remaining' : 'Cancel'}
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent>
                                        {CANCELLATION_REASONS.map(reason => (
                                            <DropdownMenuItem key={reason} onSelect={() =>
                                                qtyServed > 0 ? handleCancelRemaining(reason) : handleCancel(reason)
                                            }>
                                                {reason}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>

                                {/* Serve button */}
                                {isBatchTicket ? (
                                    <Button size="sm" onClick={openServeBatch}>
                                        <Send className="mr-2" /> Serve ({qtyRemaining})
                                    </Button>
                                ) : (
                                    <Button size="sm" onClick={() => onUpdateStatus(ticket.id, ticket.sessionId, 'served')}>
                                        <Send className="mr-2" /> Served
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </CardFooter>
            </Card>

            {/* Batch serve modal */}
            <Dialog open={serveBatchOpen} onOpenChange={setServeBatchOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Serve: {ticket.itemName}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <p className="text-sm text-muted-foreground">{qtyRemaining} remaining · {qtyServed} already served</p>
                        <div className="space-y-1">
                            <Label htmlFor="serve-qty">Qty to serve now</Label>
                            <Input
                                id="serve-qty"
                                type="number"
                                min={1}
                                max={qtyRemaining}
                                value={serveQtyInput}
                                onChange={e => setServeQtyInput(e.target.value)}
                                className="text-xl text-center font-bold"
                                autoFocus
                            />
                            <p className="text-xs text-muted-foreground text-center">Max: {qtyRemaining}</p>
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setServeBatchOpen(false)}>Cancel</Button>
                        <Button
                            onClick={handleServeBatchConfirm}
                            disabled={isNaN(parseInt(serveQtyInput,10)) || parseInt(serveQtyInput,10) <= 0 || parseInt(serveQtyInput,10) > qtyRemaining}
                        >
                            <Send className="mr-2"/> Confirm Serve
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {ConfirmDialog}
        </>
    );
}
