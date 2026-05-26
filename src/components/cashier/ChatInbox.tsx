"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
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
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Loader2, ArrowLeft, Check, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { fireKitchenAlert, primeKitchenAudio } from "@/lib/notifications/kitchenAlert";

type ChatThread = {
  id: string;
  customerName?: string | null;
  phone?: string | null;
  status: "open" | "closed";
  lastMessageText?: string | null;
  lastMessageBy?: "customer" | "staff" | null;
  lastMessageAtClientMs?: number | null;
  createdAtClientMs: number;
  unreadForStaff?: number;
};

type ChatMessage = {
  id: string;
  sender: "customer" | "staff";
  text: string;
  staffName?: string | null;
  createdAtClientMs: number;
};

function fmtClock(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatInbox({ storeId }: { storeId: string | null | undefined }) {
  const { appUser } = useAuthContext();
  const { currentProfile } = useLocalProfile();
  const [open, setOpen] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
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

  const totalUnread = useMemo(() => threads.reduce((n, t) => n + (t.unreadForStaff || 0), 0), [threads]);

  // Chime when the staff-unread total rises (a new customer message arrived).
  useEffect(() => {
    if (prevUnread.current != null && totalUnread > prevUnread.current) {
      void fireKitchenAlert({ title: "New website chat", body: "A customer messaged on the website." });
    }
    prevUnread.current = totalUnread;
  }, [totalUnread]);

  // Conversation listener for the selected thread.
  useEffect(() => {
    if (!storeId || !activeThreadId) { setMessages([]); return; }
    const q = query(
      collection(db, `stores/${storeId}/chatThreads/${activeThreadId}/messages`),
      orderBy("createdAtClientMs", "asc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as ChatMessage));
    });
    return () => unsub();
  }, [storeId, activeThreadId]);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null;

  async function openThread(t: ChatThread) {
    setActiveThreadId(t.id);
    if (storeId && (t.unreadForStaff || 0) > 0) {
      try { await updateDoc(doc(db, `stores/${storeId}/chatThreads/${t.id}`), { unreadForStaff: 0 }); } catch {}
    }
  }

  async function sendReply() {
    const text = reply.trim();
    if (!storeId || !activeThreadId || !text || sending) return;
    setSending(true);
    try {
      const staffName = currentProfile?.name || appUser?.displayName || appUser?.name || "Staff";
      const now = Date.now();
      await addDoc(collection(db, `stores/${storeId}/chatThreads/${activeThreadId}/messages`), {
        sender: "staff",
        text,
        staffName,
        createdAt: serverTimestamp(),
        createdAtClientMs: now,
      });
      await updateDoc(doc(db, `stores/${storeId}/chatThreads/${activeThreadId}`), {
        lastMessageText: text,
        lastMessageBy: "staff",
        lastMessageAtClientMs: now,
        unreadForStaff: 0,
        updatedAt: serverTimestamp(),
      });
      setReply("");
    } catch (e) {
      console.error("[ChatInbox] sendReply failed:", e);
    } finally {
      setSending(false);
    }
  }

  async function closeThread() {
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
              <SheetHeader className="p-4 border-b">
                <SheetTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5" /> Website Chats</SheetTitle>
                <SheetDescription>Live messages from the website. Tap one to reply.</SheetDescription>
              </SheetHeader>
              <ScrollArea className="flex-1 px-3 py-3">
                {threads.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">No open chats.</p>
                ) : (
                  <div className="space-y-2">
                    {threads.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => openThread(t)}
                        className="w-full text-left rounded-lg border bg-background p-3 hover:bg-muted/50 transition"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-sm truncate">{t.customerName || "Website visitor"}</div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-muted-foreground">{fmtClock(t.lastMessageAtClientMs)}</span>
                            {(t.unreadForStaff || 0) > 0 && (
                              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 justify-center text-xs">{t.unreadForStaff}</Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {t.lastMessageBy === "staff" ? "You: " : ""}{t.lastMessageText || "…"}
                        </div>
                      </button>
                    ))}
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
                  <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={closeThread}>
                    <Check className="h-4 w-4 mr-1" /> Close
                  </Button>
                </div>
              </SheetHeader>
              <ScrollArea className="flex-1 px-3 py-3">
                <div className="space-y-2">
                  {messages.map((m) => {
                    const staff = m.sender === "staff";
                    return (
                      <div key={m.id} className={staff ? "flex justify-end" : "flex justify-start"}>
                        <div className={cn(
                          "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                          staff ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
                        )}>
                          {staff && m.staffName && <div className="text-[10px] font-semibold opacity-70 mb-0.5">{m.staffName}</div>}
                          <div className="whitespace-pre-wrap break-words">{m.text}</div>
                          <div className="text-[10px] opacity-60 mt-0.5 text-right">{fmtClock(m.createdAtClientMs)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
              <div className="flex items-end gap-2 border-t p-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendReply(); } }}
                  rows={1}
                  maxLength={500}
                  placeholder="Type a reply…"
                  className="resize-none min-h-[40px] text-sm"
                />
                <Button size="icon" className="shrink-0" onClick={() => void sendReply()} disabled={sending || reply.trim().length === 0}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
