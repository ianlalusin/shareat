"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useLocalProfile } from "@/context/local-profile-context";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Loader2, ArrowLeft, Check, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { fireKitchenAlert, primeKitchenAudio } from "@/lib/notifications/kitchenAlert";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { ChatThreadPane } from "./ChatThreadPane";
import type { ChatThread } from "./chat-types";

// A customer message left unread/unreplied longer than this shows a red dot.
const STALE_UNREAD_MS = 5 * 60 * 1000;

function fmtClock(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatInbox({ storeId }: { storeId: string | null | undefined }) {
  const { appUser } = useAuthContext();
  const { currentProfile } = useLocalProfile();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [listTab, setListTab] = useState<"open" | "closed">("open");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [closedThreads, setClosedThreads] = useState<ChatThread[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  // Drives the red "stale unread" dot so it appears after 5 min even with no
  // new activity. Cheap re-render, no extra reads.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const prevUnread = useRef<number | null>(null);

  useEffect(() => { primeKitchenAudio(); }, []);

  // Live open threads for this store (equality query → no composite index).
  useEffect(() => {
    if (!storeId) { setThreads([]); return; }
    const q = query(collection(db, `stores/${storeId}/chatThreads`), where("status", "==", "open"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as ChatThread)
          .sort((a, b) => (b.lastMessageAtClientMs || 0) - (a.lastMessageAtClientMs || 0));
        setThreads(rows);
      },
      (err) => console.error("[ChatInbox] threads snapshot error:", err),
    );
    return () => unsub();
  }, [storeId]);

  // Closed threads are historical — no live listener (that would accrue reads
  // forever). Fetch once on demand whenever the Closed tab is opened.
  useEffect(() => {
    if (!open || listTab !== "closed" || !storeId) return;
    let cancelled = false;
    setClosedLoading(true);
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, `stores/${storeId}/chatThreads`), where("status", "==", "closed")));
        if (cancelled) return;
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as ChatThread)
          .sort((a, b) => (b.lastMessageAtClientMs || 0) - (a.lastMessageAtClientMs || 0));
        setClosedThreads(rows);
      } catch (e) {
        console.error("[ChatInbox] closed threads fetch error:", e);
      } finally {
        if (!cancelled) setClosedLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, listTab, storeId]);

  const totalUnread = useMemo(() => threads.reduce((n, t) => n + (t.unreadForStaff || 0), 0), [threads]);

  // Chime when the staff-unread total rises (a new customer message arrived),
  // unless the cashier is already in a conversation (avoid chiming while typing).
  useEffect(() => {
    if (prevUnread.current != null && totalUnread > prevUnread.current) {
      const activelyChatting = open && activeThreadId != null;
      if (!activelyChatting) void fireKitchenAlert({ title: "New website chat", body: "A customer messaged on the website." });
    }
    prevUnread.current = totalUnread;
  }, [totalUnread, open, activeThreadId]);

  const activeThread =
    threads.find((t) => t.id === activeThreadId) ??
    closedThreads.find((t) => t.id === activeThreadId) ??
    null;
  const isActiveClosed = activeThread?.status === "closed";
  const displayedThreads = listTab === "open" ? threads : closedThreads;

  async function openThread(t: ChatThread) {
    setActiveThreadId(t.id);
    if (storeId && (t.unreadForStaff || 0) > 0) {
      try { await updateDoc(doc(db, `stores/${storeId}/chatThreads/${t.id}`), { unreadForStaff: 0 }); } catch {}
    }
  }

  async function closeThreadInternal() {
    if (!storeId || !activeThreadId) return;
    try {
      await updateDoc(doc(db, `stores/${storeId}/chatThreads/${activeThreadId}`), {
        status: "closed",
        closedAt: serverTimestamp(),
        closedByUid: appUser?.uid ?? null,
        closedByName: currentProfile?.name || appUser?.displayName || appUser?.name || null,
      });
      setActiveThreadId(null);
    } catch (e) {
      console.error("[ChatInbox] closeThread failed:", e);
    }
  }

  async function endChat() {
    if (!storeId || !activeThreadId) return;
    const ok = await confirm({
      title: "End this chat?",
      description: "This closes the conversation. The visitor will see it as closed.",
      confirmText: "End chat",
    });
    if (ok) await closeThreadInternal();
  }

  return (
    <>
      {/* Floating button — stacked above the weather FAB (bottom-6) */}
      <div className="fixed bottom-24 right-6 z-40">
        {totalUnread > 0 && !open && (
          <span aria-hidden className="absolute inset-0 rounded-full bg-destructive/60 animate-ping" />
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "relative h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-2xl",
            "flex items-center justify-center hover:scale-105 active:scale-95 transition-transform ring-4 ring-primary/20",
            totalUnread > 0 && !open && "animate-bounce",
          )}
          aria-label="Website chats"
          title={totalUnread > 0 ? `${totalUnread} unread chat message(s)` : "Website chats"}
        >
          <MessageSquare className="h-6 w-6" />
          {totalUnread > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-6 min-w-6 px-1.5 justify-center text-xs font-bold">
              {totalUnread}
            </Badge>
          )}
        </button>
      </div>

      <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) setActiveThreadId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col">
          {!activeThread ? (
            <>
              <SheetHeader className="p-4 pb-2 border-b">
                <SheetTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Website Chats</SheetTitle>
                <SheetDescription>
                  {listTab === "open" ? "Live messages from the website. Tap one to reply." : "Previously closed conversations."}
                </SheetDescription>
                <div className="inline-flex rounded-md border p-0.5 mt-2 w-fit">
                  <Button variant={listTab === "open" ? "secondary" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => setListTab("open")}>
                    Open{threads.length > 0 ? ` (${threads.length})` : ""}
                  </Button>
                  <Button variant={listTab === "closed" ? "secondary" : "ghost"} size="sm" className="h-7 px-3 text-xs" onClick={() => setListTab("closed")}>
                    Closed
                  </Button>
                </div>
              </SheetHeader>
              <ScrollArea className="flex-1 px-3 py-3">
                {listTab === "closed" && closedLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : displayedThreads.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    {listTab === "open" ? "No open chats." : "No closed chats."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {displayedThreads.map((t) => {
                      const unread = (t.unreadForStaff || 0) > 0;
                      const stale =
                        unread &&
                        t.lastMessageBy === "customer" &&
                        nowTick - (t.lastMessageAtClientMs || 0) > STALE_UNREAD_MS;
                      return (
                      <button
                        key={t.id}
                        onClick={() => openThread(t)}
                        className="w-full text-left rounded-lg border bg-background p-3 hover:bg-muted/50 transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {unread && (
                              <span
                                className={cn(
                                  "h-2.5 w-2.5 rounded-full shrink-0",
                                  stale ? "bg-red-500 animate-pulse" : "bg-emerald-500",
                                )}
                                title={stale ? "Unread for over 5 minutes — needs a reply" : "Unread message"}
                              />
                            )}
                            <div className="font-semibold text-sm truncate">{t.customerName || "Website visitor"}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground">{fmtClock(t.lastMessageAtClientMs)}</span>
                            {unread && (
                              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 justify-center text-xs">{t.unreadForStaff}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {t.lastMessageBy === "staff" ? "You: " : ""}{t.lastMessageText || "…"}
                        </div>
                      </button>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </>
          ) : (
            <>
              <SheetHeader className="p-3 border-b">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setActiveThreadId(null)}>
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1">
                    <SheetTitle className="text-base truncate">{activeThread.customerName || "Website visitor"}</SheetTitle>
                    {activeThread.phone && (
                      <SheetDescription className="flex items-center gap-1 text-xs"><Phone className="h-3 w-3" /> {activeThread.phone}</SheetDescription>
                    )}
                  </div>
                  {isActiveClosed ? (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">Closed</Badge>
                  ) : (
                    <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => void endChat()}>
                      <Check className="h-4 w-4 mr-1" /> End chat
                    </Button>
                  )}
                </div>
              </SheetHeader>
              {storeId && activeThreadId && (
                <ChatThreadPane
                  storeId={storeId}
                  threadId={activeThreadId}
                  isClosed={isActiveClosed}
                  onClosed={() => setActiveThreadId(null)}
                />
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      {ConfirmDialog}
    </>
  );
}
