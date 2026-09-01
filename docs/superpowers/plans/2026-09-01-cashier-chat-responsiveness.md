# Cashier Chat Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure cashier chat-response timeliness and efficiency (fairly attributed via on-duty presence), surface it on the POS printed daily sales report, and feed it into the ERP cashier performance score.

**Architecture:** POS gains a lightweight presence log (who's signed into the cashier station and when), a server-side route that stamps each answered customer message with a *fair* elapsed time and rolls counts into the existing per-day `analytics/{dayId}` doc (same shape family as kitchen/server service times). The printed report and its on-screen preview read that rollup, same as they already do for "Avg confirm (server)". ERP pulls the raw counts across the existing POS→ERP staff-metrics bridge and adds one more weighted dimension to `computeStaffScore`.

**Tech Stack:** Next.js (POS + ERP-rebuild), Firebase Admin SDK (Firestore transactions), Firebase Client SDK, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-cashier-chat-responsiveness-design.md` (this repo) — read it alongside this plan; it has the full rationale for the fairness attribution model.

## Global Constraints

- 2-minute response standard: `CHAT_RESPONSE_STANDARD_MS = 2 * 60 * 1000`.
- Score formula: `80% timeliness + 20% efficiency` (either side may be null; both null ⇒ no score).
- Rating buckets (printed report only): `<20` very poor, `20–40` poor, `40–60` average, `60–80` good, `≥80` very good.
- Analytics rollup writes (`stores/{storeId}/analytics*`) MUST go through the admin SDK (server route) — POS's `firestore.rules` explicitly excludes `analytics`/`analyticsMonths`/`analyticsYears` from client writes (see rules file ~line 340). Do not attempt a direct client write to these paths.
- `chatThreads` and its `messages` subcollection, and the new `chatPresenceLog` collection, ARE covered by POS's general per-store catch-all rule (`hasStoreAccess(storeId)`) — no rules file changes needed for those.
- Manila-timezone day bucketing: always derive `dayId` via the existing `getDayIdFromTimestamp()` (`src/lib/analytics/daily.ts`) — never hand-roll date math (see `reference_server_side_time_formatting_utc` — UTC/local mismatches are a known landmine in this codebase).
- Follow existing code style: no new comments unless explaining a non-obvious WHY (this codebase already does this well — match it).

---

## Task 1: On-duty presence — pure lookup functions (POS)

**Files:**
- Create: `src/lib/chat/presence.ts`
- Test: `src/lib/chat/presence.test.ts`

**Interfaces:**
- Produces: `PresenceEvent` type, `resolveOnDutyAt(events, atMs)`, `resolveOnDutySince(events, profileId, atMs)` — both pure, no Firestore. Later tasks (4) consume these exact signatures.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chat/presence.test.ts
import { describe, it, expect } from "vitest";
import { resolveOnDutyAt, resolveOnDutySince, type PresenceEvent } from "./presence";

const ev = (profileId: string, event: "signin" | "signout", atClientMs: number, profileName = profileId): PresenceEvent =>
  ({ profileId, profileName, event, atClientMs });

describe("resolveOnDutyAt", () => {
  it("returns null when nobody has signed in yet", () => {
    expect(resolveOnDutyAt([], 1000)).toBeNull();
  });

  it("returns the signed-in profile at the query time", () => {
    const events = [ev("p1", "signin", 100)];
    expect(resolveOnDutyAt(events, 500)).toEqual({ profileId: "p1", profileName: "p1" });
  });

  it("returns null after a signout", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200)];
    expect(resolveOnDutyAt(events, 500)).toBeNull();
  });

  it("reflects a handover to a second profile", () => {
    const events = [
      ev("p1", "signin", 100),
      ev("p1", "signout", 300),
      ev("p2", "signin", 300),
    ];
    expect(resolveOnDutyAt(events, 250)).toEqual({ profileId: "p1", profileName: "p1" });
    expect(resolveOnDutyAt(events, 400)).toEqual({ profileId: "p2", profileName: "p2" });
  });

  it("ignores events after the query time", () => {
    const events = [ev("p1", "signin", 100), ev("p2", "signin", 900)];
    expect(resolveOnDutyAt(events, 500)).toEqual({ profileId: "p1", profileName: "p1" });
  });
});

describe("resolveOnDutySince", () => {
  it("returns null when the profile was never signed in by atMs", () => {
    expect(resolveOnDutySince([ev("p1", "signin", 900)], "p1", 500)).toBeNull();
  });

  it("returns the signin timestamp of the current stretch", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200), ev("p1", "signin", 300)];
    expect(resolveOnDutySince(events, "p1", 500)).toBe(300);
  });

  it("returns null once that profile has signed out", () => {
    const events = [ev("p1", "signin", 100), ev("p1", "signout", 200)];
    expect(resolveOnDutySince(events, "p1", 500)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/chat/presence.test.ts`
Expected: FAIL — `Cannot find module './presence'`

- [ ] **Step 3: Implement**

```ts
// src/lib/chat/presence.ts

export type PresenceEvent = {
  profileId: string;
  profileName: string;
  event: "signin" | "signout";
  atClientMs: number;
};

/**
 * Who was on duty at `atMs`, replaying a store's presence-event log in order.
 * A device has one active local profile at a time, so this is a straight
 * chronological replay, not an interval-overlap problem.
 */
export function resolveOnDutyAt(
  events: PresenceEvent[],
  atMs: number,
): { profileId: string; profileName: string } | null {
  const relevant = events
    .filter((e) => e.atClientMs <= atMs)
    .sort((a, b) => a.atClientMs - b.atClientMs);
  let current: { profileId: string; profileName: string } | null = null;
  for (const e of relevant) {
    if (e.event === "signin") current = { profileId: e.profileId, profileName: e.profileName };
    else if (e.event === "signout" && current?.profileId === e.profileId) current = null;
  }
  return current;
}

/**
 * The start (ms) of `profileId`'s current on-duty stretch as of `atMs`, or
 * null if they weren't on duty at `atMs`. Used to fairly clock a responder's
 * OWN elapsed time — never from before they were actually on duty.
 */
export function resolveOnDutySince(
  events: PresenceEvent[],
  profileId: string,
  atMs: number,
): number | null {
  const relevant = events
    .filter((e) => e.profileId === profileId && e.atClientMs <= atMs)
    .sort((a, b) => a.atClientMs - b.atClientMs);
  let since: number | null = null;
  for (const e of relevant) {
    since = e.event === "signin" ? e.atClientMs : null;
  }
  return since;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chat/presence.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/presence.ts src/lib/chat/presence.test.ts
git commit -m "feat: add pure on-duty presence lookup for chat attribution"
```

---

## Task 2: Fair response timing — pure scoring functions (POS)

**Files:**
- Create: `src/lib/chat/responseTiming.ts`
- Test: `src/lib/chat/responseTiming.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `CHAT_RESPONSE_STANDARD_MS`, `computeFairResponseMs(arrivalMs, responderOnDutyStartMs, respondedAtMs)`, `isWithinStandard(fairResponseMs)`, `computeChatScore(timelinessPct, efficiencyPct)`, `chatRatingLabel(score)`, `ChatRating` type. Consumed by Task 4 (server route) and Task 7 (printed report aggregator).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chat/responseTiming.test.ts
import { describe, it, expect } from "vitest";
import {
  CHAT_RESPONSE_STANDARD_MS,
  computeFairResponseMs,
  isWithinStandard,
  computeChatScore,
  chatRatingLabel,
} from "./responseTiming";

describe("computeFairResponseMs", () => {
  it("measures from arrival when the responder was already on duty", () => {
    // arrived 10:00:00, responder on duty since 09:00, replied 10:01:30
    const arrival = 0;
    const onDutySince = -60 * 60 * 1000;
    const respondedAt = 90 * 1000;
    expect(computeFairResponseMs(arrival, onDutySince, respondedAt)).toBe(90 * 1000);
  });

  it("measures from the responder's on-duty start when they came on duty AFTER arrival", () => {
    // message arrived at t=0, sat unanswered, cashier 2 signed in at t=5min,
    // replied at t=5min30s -> fair time is 30s, not 5min30s
    const arrival = 0;
    const onDutySince = 5 * 60 * 1000;
    const respondedAt = 5 * 60 * 1000 + 30 * 1000;
    expect(computeFairResponseMs(arrival, onDutySince, respondedAt)).toBe(30 * 1000);
  });

  it("falls back to raw arrival time when there is no on-duty signal at all", () => {
    expect(computeFairResponseMs(0, null, 45_000)).toBe(45_000);
  });

  it("never goes negative", () => {
    expect(computeFairResponseMs(1000, 2000, 500)).toBe(0);
  });
});

describe("isWithinStandard", () => {
  it("is true at exactly the 2-minute standard", () => {
    expect(isWithinStandard(CHAT_RESPONSE_STANDARD_MS)).toBe(true);
  });
  it("is false one ms over", () => {
    expect(isWithinStandard(CHAT_RESPONSE_STANDARD_MS + 1)).toBe(false);
  });
});

describe("computeChatScore", () => {
  it("blends 80% timeliness + 20% efficiency", () => {
    expect(computeChatScore(100, 50)).toBe(90);
    expect(computeChatScore(50, 100)).toBe(60);
  });
  it("falls back to whichever side has a basis", () => {
    expect(computeChatScore(75, null)).toBe(75);
    expect(computeChatScore(null, 40)).toBe(40);
  });
  it("is null when neither side has a basis", () => {
    expect(computeChatScore(null, null)).toBeNull();
  });
});

describe("chatRatingLabel", () => {
  it.each([
    [0, "very poor"], [19.9, "very poor"],
    [20, "poor"], [39.9, "poor"],
    [40, "average"], [59.9, "average"],
    [60, "good"], [79.9, "good"],
    [80, "very good"], [100, "very good"],
  ])("scores %d as %s", (score, label) => {
    expect(chatRatingLabel(score)).toBe(label);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/chat/responseTiming.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// src/lib/chat/responseTiming.ts

export const CHAT_RESPONSE_STANDARD_MS = 2 * 60 * 1000;

/**
 * Elapsed time credited to a responder: from whichever is LATER — the
 * message's arrival, or the responder's own on-duty start. A cashier who
 * inherits a stale message from a shift handover is timed from when they
 * actually came on duty, never from before.
 */
export function computeFairResponseMs(
  arrivalMs: number,
  responderOnDutyStartMs: number | null,
  respondedAtMs: number,
): number {
  const effectiveStart = responderOnDutyStartMs != null
    ? Math.max(arrivalMs, responderOnDutyStartMs)
    : arrivalMs;
  return Math.max(0, respondedAtMs - effectiveStart);
}

export function isWithinStandard(fairResponseMs: number): boolean {
  return fairResponseMs <= CHAT_RESPONSE_STANDARD_MS;
}

export type ChatRating = "very poor" | "poor" | "average" | "good" | "very good";

/**
 * 80% timeliness (answered-within-standard rate) + 20% efficiency (answered /
 * received-while-on-duty rate), both 0–100. Either side may be null (no
 * basis); both null -> no score.
 */
export function computeChatScore(
  timelinessPct: number | null,
  efficiencyPct: number | null,
): number | null {
  if (timelinessPct == null && efficiencyPct == null) return null;
  if (efficiencyPct == null) return timelinessPct;
  if (timelinessPct == null) return efficiencyPct;
  return Math.round((0.8 * timelinessPct + 0.2 * efficiencyPct) * 10) / 10;
}

export function chatRatingLabel(score: number): ChatRating {
  if (score < 20) return "very poor";
  if (score < 40) return "poor";
  if (score < 60) return "average";
  if (score < 80) return "good";
  return "very good";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chat/responseTiming.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/responseTiming.ts src/lib/chat/responseTiming.test.ts
git commit -m "feat: add fair chat response timing + rating pure functions"
```

---

## Task 3: Presence log — client writer wired into ChatInbox (POS)

**Files:**
- Modify: `src/components/cashier/ChatInbox.tsx`

**Interfaces:**
- Consumes: `PresenceEvent` type (Task 1, for shape reference only — this task writes plain objects matching it).
- Produces: `stores/{storeId}/chatPresenceLog/{eventId}` documents. Consumed by Task 4 (server route reads this collection).

- [ ] **Step 1: Add the presence-write effect**

In `ChatInbox.tsx`, add near the top-level imports:

```ts
import { addDoc, collection as fsCollection, serverTimestamp as fsServerTimestamp } from "firebase/firestore";
```

(`collection`/`serverTimestamp` are already imported under those names — alias the additions only if there's a naming clash; otherwise reuse the existing `collection`/`serverTimestamp` imports directly.)

Add this effect inside `ChatInbox`, after the existing `currentProfile` destructure (line 47):

```tsx
// Presence log for chat on-duty attribution. Scoped to THIS component
// (mounted only on cashier-station views) so a KDS/server device's local
// profile never pollutes "who's on duty for chat". Logs a signout for the
// previous profile immediately followed by a signin for the new one, and a
// signout on unmount.
const prevProfileRef = useRef<{ profileId: string; profileName: string } | null>(null);
useEffect(() => {
  if (!storeId) return;
  const prev = prevProfileRef.current;
  const next = currentProfile ? { profileId: currentProfile.profileId, profileName: currentProfile.name } : null;
  if (prev?.profileId === next?.profileId) return;
  const now = Date.now();
  const logRef = collection(db, `stores/${storeId}/chatPresenceLog`);
  (async () => {
    try {
      if (prev) {
        await addDoc(logRef, { profileId: prev.profileId, profileName: prev.profileName, event: "signout", atClientMs: now, atServer: serverTimestamp() });
      }
      if (next) {
        await addDoc(logRef, { profileId: next.profileId, profileName: next.profileName, event: "signin", atClientMs: now, atServer: serverTimestamp() });
      }
    } catch (e) {
      console.error("[ChatInbox] presence log write failed:", e);
    }
  })();
  prevProfileRef.current = next;
}, [storeId, currentProfile]);

useEffect(() => {
  return () => {
    const prev = prevProfileRef.current;
    if (!storeId || !prev) return;
    void addDoc(collection(db, `stores/${storeId}/chatPresenceLog`), {
      profileId: prev.profileId, profileName: prev.profileName, event: "signout",
      atClientMs: Date.now(), atServer: serverTimestamp(),
    }).catch((e) => console.error("[ChatInbox] presence signout on unmount failed:", e));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [storeId]);
```

Add `useRef` to the existing `"use client"` React import line if not already imported (it already imports `useEffect, useMemo, useRef, useState` — confirm `useRef` is present; it is, per the existing `prevUnread = useRef<number | null>(null)` on line 62).

- [ ] **Step 2: Smoketest**

Run: `npm run dev` (POS dev server, port 9003 per this machine's reserved-ports table)
- Sign into a local cashier profile, open the chat FAB (confirms `ChatInbox` still renders with no errors).
- In the Firebase console (or an admin script) for the dev store, confirm a `chatPresenceLog` doc appeared with `event: "signin"`.
- Switch to a different local profile via the profile switcher; confirm a `signout` for the old profile and a `signin` for the new one both appear.

Expected: no console errors, `chatPresenceLog` docs appear as described.

- [ ] **Step 3: Commit**

```bash
git add src/components/cashier/ChatInbox.tsx
git commit -m "feat: log cashier-station presence for chat on-duty attribution"
```

---

## Task 4: Chat response server route (POS)

**Files:**
- Create: `src/lib/server/analytics/applyChatResponseServer.ts`
- Create: `src/app/api/analytics/chat-response/route.ts`

**Interfaces:**
- Consumes: `resolveOnDutyAt`, `resolveOnDutySince`, `PresenceEvent` (Task 1); `computeFairResponseMs`, `isWithinStandard` (Task 2); `getDayIdFromTimestamp` (`src/lib/analytics/daily.ts`, existing).
- Produces: `POST /api/analytics/chat-response` — body `{storeId, threadId, respondedByProfileId, respondedByName, respondedAtClientMs, pendingMessageIds: string[]}`, response `{ok:true, stampedCount}`. Consumed by Task 5.
- Side effects: stamps `stores/{storeId}/chatThreads/{threadId}/messages/{id}` docs with `respondedAtClientMs, responseMs, respondedByProfileId, respondedByName, onDutyProfileIdAtArrival`; increments `stores/{storeId}/analytics{,Months,Years}/{id}.chat.*`.

- [ ] **Step 1: Implement the admin-SDK writer**

```ts
// src/lib/server/analytics/applyChatResponseServer.ts
import type { Firestore as AdminFirestore, Transaction } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { resolveOnDutyAt, resolveOnDutySince, type PresenceEvent } from "@/lib/chat/presence";
import { computeFairResponseMs, isWithinStandard } from "@/lib/chat/responseTiming";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";

type DayAgg = {
  responseMsSum: Record<string, number>;
  responseCount: Record<string, number>;
  within2Min: Record<string, number>;
  receivedWhileOnDuty: Record<string, number>;
  answeredWhileOnDuty: Record<string, number>;
  totalReceived: number;
  staffNames: Record<string, string>;
};

function emptyDayAgg(): DayAgg {
  return { responseMsSum: {}, responseCount: {}, within2Min: {}, receivedWhileOnDuty: {}, answeredWhileOnDuty: {}, totalReceived: 0, staffNames: {} };
}

function bump(rec: Record<string, number>, key: string, by = 1) {
  rec[key] = (rec[key] ?? 0) + by;
}

/**
 * Applies one staff reply's effect: re-derives each pending message's actual
 * state from Firestore (never trusts client-supplied timestamps for
 * scoring), stamps it, and returns the per-day rollup deltas to write.
 * Pure with respect to Firestore reads already performed by the caller
 * (`pendingMessages`, `presenceEvents`) — no I/O of its own, so it's callable
 * both inside a transaction and unit-tested directly.
 */
export function computeChatResponseDeltas(
  pendingMessages: { id: string; createdAtClientMs: number }[],
  presenceEvents: PresenceEvent[],
  respondedByProfileId: string,
  respondedByName: string,
  respondedAtClientMs: number,
): { stamps: Map<string, { responseMs: number; onDutyProfileIdAtArrival: string | null }>; dayAggs: Map<string, DayAgg> } {
  const responderOnDutyStart = resolveOnDutySince(presenceEvents, respondedByProfileId, respondedAtClientMs);
  const stamps = new Map<string, { responseMs: number; onDutyProfileIdAtArrival: string | null }>();
  const dayAggs = new Map<string, DayAgg>();

  for (const msg of pendingMessages) {
    const fairMs = computeFairResponseMs(msg.createdAtClientMs, responderOnDutyStart, respondedAtClientMs);
    const onDuty = resolveOnDutyAt(presenceEvents, msg.createdAtClientMs);
    stamps.set(msg.id, { responseMs: fairMs, onDutyProfileIdAtArrival: onDuty?.profileId ?? null });

    const dayId = getDayIdFromTimestamp(msg.createdAtClientMs);
    const day = dayAggs.get(dayId) ?? emptyDayAgg();
    bump(day.responseMsSum, respondedByProfileId, fairMs);
    bump(day.responseCount, respondedByProfileId, 1);
    if (isWithinStandard(fairMs)) bump(day.within2Min, respondedByProfileId, 1);
    if (onDuty) {
      bump(day.receivedWhileOnDuty, onDuty.profileId, 1);
      if (onDuty.profileId === respondedByProfileId) bump(day.answeredWhileOnDuty, onDuty.profileId, 1);
      day.staffNames[onDuty.profileId] = onDuty.profileName;
    }
    day.totalReceived += 1;
    day.staffNames[respondedByProfileId] = respondedByName;
    dayAggs.set(dayId, day);
  }

  return { stamps, dayAggs };
}

/** Runs computeChatResponseDeltas against live reads inside a transaction and
 *  writes the stamps + rollup increments. Re-verifies each message is still
 *  an unanswered customer message before stamping (idempotent under a race
 *  between two staff replying to the same thread near-simultaneously). */
export async function applyChatResponseServer(
  db: AdminFirestore,
  storeId: string,
  threadId: string,
  respondedByProfileId: string,
  respondedByName: string,
  respondedAtClientMs: number,
  pendingMessageIds: string[],
): Promise<{ stampedCount: number }> {
  return db.runTransaction(async (tx: Transaction) => {
    const msgRefs = pendingMessageIds.map((id) => db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`));
    const msgSnaps = await Promise.all(msgRefs.map((r) => tx.get(r)));
    const pendingMessages = msgSnaps
      .map((snap) => (snap.exists ? { id: snap.id, data: snap.data() as any } : null))
      .filter((m): m is { id: string; data: any } => m != null && m.data.sender === "customer" && m.data.respondedAtClientMs == null)
      .map((m) => ({ id: m.id, createdAtClientMs: Number(m.data.createdAtClientMs) }));

    if (pendingMessages.length === 0) return { stampedCount: 0 };

    // Bounded: presence events are low-frequency (one per sign-in/out), so the
    // 500 most-recent events at-or-before this reply covers many weeks of
    // shift changes without an unbounded per-reply read as the log grows.
    const presenceQuery = db.collection(`stores/${storeId}/chatPresenceLog`)
      .where("atClientMs", "<=", respondedAtClientMs)
      .orderBy("atClientMs", "desc")
      .limit(500);
    const presenceSnap = await tx.get(presenceQuery);
    const presenceEvents: PresenceEvent[] = presenceSnap.docs.map((d) => d.data() as PresenceEvent);

    const { stamps, dayAggs } = computeChatResponseDeltas(
      pendingMessages, presenceEvents, respondedByProfileId, respondedByName, respondedAtClientMs,
    );

    for (const [id, stamp] of stamps) {
      tx.update(db.doc(`stores/${storeId}/chatThreads/${threadId}/messages/${id}`), {
        respondedAtClientMs,
        responseMs: stamp.responseMs,
        respondedByProfileId,
        respondedByName,
        onDutyProfileIdAtArrival: stamp.onDutyProfileIdAtArrival,
      });
    }

    for (const [dayId, agg] of dayAggs) {
      const monthId = dayId.slice(0, 6);
      const yearId = dayId.slice(0, 4);
      const payload: Record<string, unknown> = { "meta.updatedAt": FieldValue.serverTimestamp() };
      for (const [pid, v] of Object.entries(agg.responseMsSum)) payload[`chat.responseMsSumByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.responseCount)) payload[`chat.responseCountByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.within2Min)) payload[`chat.within2MinCountByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.receivedWhileOnDuty)) payload[`chat.receivedWhileOnDutyByUser.${pid}`] = FieldValue.increment(v);
      for (const [pid, v] of Object.entries(agg.answeredWhileOnDuty)) payload[`chat.answeredWhileOnDutyByUser.${pid}`] = FieldValue.increment(v);
      payload["chat.totalReceived"] = FieldValue.increment(agg.totalReceived);
      for (const [pid, name] of Object.entries(agg.staffNames)) payload[`staffNames.${pid}`] = name;

      for (const path of [
        `stores/${storeId}/analytics/${dayId}`,
        `stores/${storeId}/analyticsMonths/${monthId}`,
        `stores/${storeId}/analyticsYears/${yearId}`,
      ]) {
        tx.set(db.doc(path), { meta: { updatedAt: FieldValue.serverTimestamp() } }, { merge: true });
        tx.update(db.doc(path), payload);
      }
    }

    return { stampedCount: stamps.size };
  });
}
```

- [ ] **Step 2: Unit test `computeChatResponseDeltas`**

```ts
// src/lib/server/analytics/applyChatResponseServer.test.ts
import { describe, it, expect } from "vitest";
import { computeChatResponseDeltas } from "./applyChatResponseServer";
import type { PresenceEvent } from "@/lib/chat/presence";

describe("computeChatResponseDeltas", () => {
  it("credits the responder's timeliness and their own on-duty efficiency in the normal case", () => {
    const presence: PresenceEvent[] = [{ profileId: "p1", profileName: "Cashier One", event: "signin", atClientMs: 0 }];
    const { stamps, dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 1000 }],
      presence, "p1", "Cashier One", 1000 + 30_000,
    );
    expect(stamps.get("m1")).toEqual({ responseMs: 30_000, onDutyProfileIdAtArrival: "p1" });
    const day = [...dayAggs.values()][0];
    expect(day.responseCount.p1).toBe(1);
    expect(day.within2Min.p1).toBe(1);
    expect(day.receivedWhileOnDuty.p1).toBe(1);
    expect(day.answeredWhileOnDuty.p1).toBe(1);
  });

  it("does not credit efficiency to a rescuing cashier, and does not add to their receivedWhileOnDuty", () => {
    const presence: PresenceEvent[] = [
      { profileId: "p1", profileName: "Cashier One", event: "signin", atClientMs: 0 },
      { profileId: "p1", profileName: "Cashier One", event: "signout", atClientMs: 600_000 },
      { profileId: "p2", profileName: "Cashier Two", event: "signin", atClientMs: 600_000 },
    ];
    // Message arrived at t=0 (on cashier1's watch), answered by cashier2 at t=600_030 (30s after cashier2 signed in)
    const { stamps, dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 0 }],
      presence, "p2", "Cashier Two", 600_030,
    );
    // cashier2's fair time is only 30s (clocked from their own on-duty start), not 600_030ms
    expect(stamps.get("m1")?.responseMs).toBe(30);
    expect(stamps.get("m1")?.onDutyProfileIdAtArrival).toBe("p1");
    const day = [...dayAggs.values()][0];
    expect(day.responseCount.p2).toBe(1); // cashier2 gets timeliness credit for answering
    expect(day.within2Min.p2).toBe(1);
    expect(day.receivedWhileOnDuty.p1).toBe(1); // charged to cashier1 (arrival), not cashier2
    expect(day.receivedWhileOnDuty.p2).toBeUndefined();
    expect(day.answeredWhileOnDuty.p1).toBeUndefined(); // cashier1 never answered it
  });

  it("skips efficiency attribution entirely when nobody was on duty at arrival", () => {
    const { dayAggs } = computeChatResponseDeltas(
      [{ id: "m1", createdAtClientMs: 0 }], [], "p1", "Cashier One", 30_000,
    );
    const day = [...dayAggs.values()][0];
    expect(day.receivedWhileOnDuty).toEqual({});
    expect(day.responseCount.p1).toBe(1); // responder still gets timeliness credit
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/lib/server/analytics/applyChatResponseServer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Implement the API route**

```ts
// src/app/api/analytics/chat-response/route.ts
import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { applyChatResponseServer } from "@/lib/server/analytics/applyChatResponseServer";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function verifyToken(req: Request): Promise<DecodedIdToken> {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing bearer token.");
  try {
    return await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    throw new Error("Invalid token.");
  }
}

function mapError(e: any) {
  const message = e?.message || "Request failed.";
  const status =
    /Missing bearer token|Invalid token/i.test(message) ? 401 :
    /not allowed|No access|Not a staff member|Staff not active/i.test(message) ? 403 :
    500;
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const storeId = String(body.storeId || "");
  const threadId = String(body.threadId || "");
  const respondedByProfileId = String(body.respondedByProfileId || "");
  const respondedByName = String(body.respondedByName || "Staff");
  const respondedAtClientMs = Number(body.respondedAtClientMs);
  const pendingMessageIds: string[] = Array.isArray(body.pendingMessageIds)
    ? body.pendingMessageIds.map((id: unknown) => String(id)).filter(Boolean)
    : [];
  if (!storeId || !threadId || !respondedByProfileId || !Number.isFinite(respondedAtClientMs) || pendingMessageIds.length === 0) {
    return bad("Missing storeId, threadId, respondedByProfileId, respondedAtClientMs, or pendingMessageIds.");
  }

  try {
    const decoded = await verifyToken(req);
    const db = getAdminDb();
    await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);

    const result = await applyChatResponseServer(
      db, storeId, threadId, respondedByProfileId, respondedByName, respondedAtClientMs, pendingMessageIds,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return mapError(e);
  }
}
```

- [ ] **Step 5: Smoketest**

Run: `npm run dev`, then with a valid ID token for a cashier user:
```bash
curl -s -X POST http://localhost:9003/api/analytics/chat-response \
  -H "Authorization: Bearer <ID_TOKEN>" -H "Content-Type: application/json" \
  -d '{"storeId":"<devStoreId>","threadId":"<threadId>","respondedByProfileId":"<pid>","respondedByName":"Test","respondedAtClientMs":1735689600000,"pendingMessageIds":["<msgId>"]}'
```
Expected: `{"ok":true,"stampedCount":1}` (or `0` if the message doesn't qualify); confirm in Firestore that the message doc got stamped and `analytics/{dayId}.chat.*` incremented.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/analytics/applyChatResponseServer.ts src/lib/server/analytics/applyChatResponseServer.test.ts src/app/api/analytics/chat-response/route.ts
git commit -m "feat: add server-side chat response attribution + analytics rollup route"
```

---

## Task 5: Wire ChatThreadPane to call the new route (POS)

**Files:**
- Modify: `src/components/cashier/ChatThreadPane.tsx:69-96` (`sendReply`)
- Modify: `src/components/cashier/chat-types.ts` (extend `ChatMessage`)

**Interfaces:**
- Consumes: `POST /api/analytics/chat-response` (Task 4).

- [ ] **Step 1: Extend `ChatMessage` type**

```ts
// src/components/cashier/chat-types.ts — add to the existing ChatMessage type
export type ChatMessage = {
  id: string;
  sender: "customer" | "staff";
  text: string;
  staffName?: string | null;
  createdAtClientMs: number;
  respondedAtClientMs?: number | null;
  responseMs?: number | null;
  respondedByProfileId?: string | null;
  respondedByName?: string | null;
  onDutyProfileIdAtArrival?: string | null;
};
```

- [ ] **Step 2: Call the route after sending a reply**

In `ChatThreadPane.tsx`, `sendReply()` (lines 69-96), after the existing `updateDoc` for the thread (after line 89, before `setReply("")`), add:

```tsx
      const pendingIds = messages
        .filter((m) => m.sender === "customer" && m.respondedAtClientMs == null)
        .map((m) => m.id);
      if (pendingIds.length > 0 && currentProfile && appUser) {
        try {
          const idToken = await appUser.getIdToken();
          await fetch("/api/analytics/chat-response", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
              storeId, threadId,
              respondedByProfileId: currentProfile.profileId,
              respondedByName: currentProfile.name,
              respondedAtClientMs: now,
              pendingMessageIds: pendingIds,
            }),
          });
        } catch (e) {
          console.error("[ChatThreadPane] chat-response analytics call failed:", e);
        }
      }
```

`appUser.getIdToken()` matches the established pattern for calling this app's own authenticated API routes — see e.g. `src/components/dashboard/customer-feedback-modal.tsx:48` (`Authorization: \`Bearer ${await user.getIdToken()}\``) and `src/lib/server-profiles/api.ts:14`.

Apply the same block to `sendClosingAndEnd()` (lines 99-137, after the first `addDoc`/`updateDoc` pair, mirroring the same "answers any pending customer messages" behavior — a closing message counts as a reply for attribution purposes).

- [ ] **Step 3: Smoketest**

Run: `npm run dev`. Send a customer message via the website chat widget (or seed a `chatThreads/{id}/messages` doc with `sender:"customer"` directly in Firestore for the dev store), then reply as a cashier in the POS chat inbox. Confirm:
- The reply appears in the thread as before (no regression).
- The customer message doc gets `respondedAtClientMs`/`responseMs`/`respondedByProfileId` stamped (check Firestore).
- `analytics/{today}.chat.responseCountByUser.<profileId>` incremented by 1.

Expected: all three confirmed, no console errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/cashier/ChatThreadPane.tsx src/components/cashier/chat-types.ts
git commit -m "feat: call chat-response analytics route when a cashier replies"
```

---

## Task 6: Extend DailyMetric type + staff-metrics bridge API (POS)

**Files:**
- Modify: `src/lib/types.ts:1394-1399` (`DailyMetric.server` block — add a sibling `chat` field)
- Modify: `src/app/api/external/staff-metrics/route.ts`

**Interfaces:**
- Produces: `DailyMetric.chat` shape (consumed by Task 7); extended `GET /api/external/staff-metrics` response `metrics[pid]` gains `chatResponseMsSum, chatResponseCount, chatWithin2MinCount, chatReceivedWhileOnDuty, chatAnsweredWhileOnDuty` (consumed by ERP Task 11).

- [ ] **Step 1: Extend `DailyMetric`**

In `src/lib/types.ts`, right after the existing `server?` block (line 1399):

```ts
    // Chat response timing + on-duty attribution. Timeliness fields are keyed
    // by RESPONDER; efficiency fields are keyed by whoever was on duty when
    // the message arrived (may differ — see chat-responsiveness design spec).
    chat?: {
        responseMsSumByUser?: Record<string, number>;
        responseCountByUser?: Record<string, number>;
        within2MinCountByUser?: Record<string, number>;
        receivedWhileOnDutyByUser?: Record<string, number>;
        answeredWhileOnDutyByUser?: Record<string, number>;
        totalReceived?: number;
    };
```

- [ ] **Step 2: Extend the external staff-metrics route**

In `src/app/api/external/staff-metrics/route.ts`:

```ts
  // Line 32: extend the Metric type
  type Metric = {
    serveMsSum: number; serveCount: number; confirmMsSum: number; confirmCount: number;
    grossSales: number; txCount: number;
    chatResponseMsSum: number; chatResponseCount: number; chatWithin2MinCount: number;
    chatReceivedWhileOnDuty: number; chatAnsweredWhileOnDuty: number;
  };
  const metrics: Record<string, Metric> = {};
  const ensure = (pid: string): Metric =>
    (metrics[pid] ??= {
      serveMsSum: 0, serveCount: 0, confirmMsSum: 0, confirmCount: 0, grossSales: 0, txCount: 0,
      chatResponseMsSum: 0, chatResponseCount: 0, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0,
    });
```

And inside the `if (analyticsSnap.exists)` block (after the existing `merge(...)` calls for kitchen/server, around line 69), add:

```ts
      const c = d?.chat ?? {};
      const mergeChat = (
        msMap: Record<string, number>, cntField: keyof Metric,
      ) => { for (const [pid, v] of Object.entries(msMap ?? {})) (ensure(pid) as any)[cntField] += num(v); };
      mergeChat(c.responseMsSumByUser ?? {}, "chatResponseMsSum");
      mergeChat(c.responseCountByUser ?? {}, "chatResponseCount");
      mergeChat(c.within2MinCountByUser ?? {}, "chatWithin2MinCount");
      mergeChat(c.receivedWhileOnDutyByUser ?? {}, "chatReceivedWhileOnDuty");
      mergeChat(c.answeredWhileOnDutyByUser ?? {}, "chatAnsweredWhileOnDuty");
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` (or this repo's equivalent — check `package.json`; POS likely has `tsc --noEmit` under a similarly named script).
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/app/api/external/staff-metrics/route.ts
git commit -m "feat: expose chat response metrics on the DailyMetric type and staff-metrics bridge"
```

---

## Task 7: Printed report + on-screen preview (POS)

**Files:**
- Modify: `src/lib/printing/salesReportFormatter.ts`
- Modify: `src/components/dashboard/SalesReportPageClient.tsx`

**Interfaces:**
- Consumes: `computeChatScore`, `chatRatingLabel` (Task 2); `DailyMetric.chat` (Task 6).
- Produces: `SalesReportData` gains `chatResponseAvgMs?`, `chatWithin2MinPct?`, `chatRatingLabel?`, `chatTotalReceived?` — consumed only within this task's own two files.

- [ ] **Step 1: Extend `SalesReportData` + formatter**

In `salesReportFormatter.ts`, extend the interface (after `serverConfirmByUser`):

```ts
  serverConfirmByUser?: { name: string; avgMs: number; count: number }[];
  // Chat responsiveness (store-wide, that day). Undefined/0 total => the whole
  // block is omitted — no chat interaction that day.
  chatResponseAvgMs?: number;
  chatWithin2MinPct?: number; // 0-100
  chatRatingLabel?: string;   // "very poor" | "poor" | "average" | "good" | "very good"
  chatTotalReceived?: number;
```

In `formatSalesReportText()`, right after the existing SERVICE TIMES block closes (after line 173, before the `--- Footer ---` comment):

```ts
  // --- Chat Response ---
  if ((data.chatTotalReceived ?? 0) > 0) {
    lines.push(center("CHAT RESPONSE"));
    lines.push(hr());
    lines.push(justify("Chat response avg", fmtDur(data.chatResponseAvgMs ?? 0)));
    lines.push(justify("Chat answered <2min", `${Math.round(data.chatWithin2MinPct ?? 0)}%`));
    lines.push(justify("Chat rating", (data.chatRatingLabel ?? "").toUpperCase()));
    lines.push(hr());
  }
```

- [ ] **Step 2: Extend the aggregator + on-screen card**

In `SalesReportPageClient.tsx`, add a sibling to `aggregateServiceTimes` (after line 170):

```ts
import { computeChatScore, chatRatingLabel } from "@/lib/chat/responseTiming";

// Store-wide chat responsiveness for the selected day/month, from the same
// analytics rollup as service times. Omitted entirely when there was no chat
// interaction in the period (totalReceived === 0).
function aggregateChatMetrics(metrics: DailyMetric[]) {
  let responseMsSum = 0, responseCount = 0, within2Min = 0;
  let receivedWhileOnDuty = 0, answeredWhileOnDuty = 0, totalReceived = 0;

  for (const m of metrics) {
    const c = (m as any).chat ?? {};
    for (const v of Object.values(c.responseMsSumByUser ?? {}) as number[]) responseMsSum += v || 0;
    for (const v of Object.values(c.responseCountByUser ?? {}) as number[]) responseCount += v || 0;
    for (const v of Object.values(c.within2MinCountByUser ?? {}) as number[]) within2Min += v || 0;
    for (const v of Object.values(c.receivedWhileOnDutyByUser ?? {}) as number[]) receivedWhileOnDuty += v || 0;
    for (const v of Object.values(c.answeredWhileOnDutyByUser ?? {}) as number[]) answeredWhileOnDuty += v || 0;
    totalReceived += c.totalReceived ?? 0;
  }

  if (totalReceived === 0) return { chatTotalReceived: 0 };

  const timelinessPct = responseCount > 0 ? (within2Min / responseCount) * 100 : null;
  const efficiencyPct = receivedWhileOnDuty > 0 ? (answeredWhileOnDuty / receivedWhileOnDuty) * 100 : null;
  const score = computeChatScore(timelinessPct, efficiencyPct);

  return {
    chatTotalReceived: totalReceived,
    chatResponseAvgMs: responseCount > 0 ? responseMsSum / responseCount : 0,
    chatWithin2MinPct: timelinessPct ?? 0,
    chatRatingLabel: score != null ? chatRatingLabel(score) : undefined,
  };
}
```

Wire it into `reportData` (line 302-327):

```ts
    const agg = aggregateMetrics(dailyMetrics);
    const svc = aggregateServiceTimes(dailyMetrics);
    const chat = aggregateChatMetrics(dailyMetrics);
    const { cashRemitted, onlineRemitted } = classifyRemittance(agg.byMethod, paymentMethods);
    // ...
    return {
      // ...
      ...agg,
      ...svc,
      ...chat,
      cashRemitted,
      onlineRemitted,
    };
```

Add an on-screen preview card after the existing Service Times card (after line 564):

```tsx
            {(agg.chatTotalReceived ?? 0) > 0 && (
              <Card className="md:col-span-2">
                <CardHeader className="pb-2"><CardTitle className="text-base">Chat Response</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <Row label="Avg response time" value={formatDuration(agg.chatResponseAvgMs ?? 0)} strong />
                  <Row label="Answered within 2 min" value={`${Math.round(agg.chatWithin2MinPct ?? 0)}%`} />
                  <Row label="Rating" value={(agg.chatRatingLabel ?? "").toUpperCase()} strong />
                </CardContent>
              </Card>
            )}
```

(Note: `agg` in the JSX at line 546 refers to `reportData` — confirm the exact local variable name used there before wiring; it's `reportData` per the `useMemo` at line 302, possibly destructured/aliased in the render section. Match whatever name the existing Service Times card block already uses for consistency.)

- [ ] **Step 3: Smoketest**

Run: `npm run dev`, open Sales Report page for a day that has the chat activity seeded in Task 5's smoketest. Confirm:
- The "Chat Response" card renders with the expected avg time / % / rating.
- Selecting a day with zero chat messages shows no such card, and the printed text (`formatSalesReportText`) has no "CHAT RESPONSE" section for that day.
- Print preview (thermal text) includes the new lines correctly formatted (check both 58mm and 80mm widths don't overflow — `justify()` already truncates long labels).

Expected: all confirmed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/printing/salesReportFormatter.ts src/components/dashboard/SalesReportPageClient.tsx
git commit -m "feat: show chat responsiveness on the printed + on-screen sales report"
```

---

## Task 8: Mount the chat bubble on every cashier-facing page (POS)

**Files:**
- Modify: `src/components/cashier/session-list-view.tsx:324` (remove the existing mount)
- Modify: `src/app/cashier/page.tsx` (add mount to `CashierPageContent`, covering both list + detail views)
- Modify: `src/components/dashboard/DashboardPageClient.tsx`
- Modify: `src/app/pins/pins-client.tsx`
- Modify: `src/components/reservations/ReservationsClient.tsx`
- Modify: `src/components/admin/online-orders/OnlineOrdersClient.tsx`

**Interfaces:**
- Consumes: `ChatInbox` component (existing, `src/components/cashier/ChatInbox.tsx`), `storeId: string | null | undefined` prop.

- [ ] **Step 1: Move the mount from `session-list-view.tsx` to `cashier/page.tsx`**

In `session-list-view.tsx`, remove line 324: `{activeStore?.id && <ChatInbox storeId={activeStore.id} />}` and its now-unused `ChatInbox` import if nothing else in that file uses it.

In `src/app/cashier/page.tsx`, inside `CashierPageContent` (the component wrapping both `SessionListView` and `SessionDetailView`), add the import `import { ChatInbox } from "@/components/cashier/ChatInbox";` and `import { useStoreContext } from "@/context/store-context";`, then render `<ChatInbox storeId={activeStore?.id} />` once alongside the existing list/detail branch (outside the `sessionId ? <SessionDetailView/> : <SessionListView/>` conditional, so it's present in both states). Pull `activeStore` from `useStoreContext()` the same way `session-list-view.tsx` already did.

- [ ] **Step 2: Add the mount to the remaining four pages**

For each of `DashboardPageClient.tsx`, `pins-client.tsx`, `ReservationsClient.tsx`, `OnlineOrdersClient.tsx` — each already has `useStoreContext()`/`activeStore` in scope (confirmed during planning). Add:

```tsx
import { ChatInbox } from "@/components/cashier/ChatInbox";
```

and render `{activeStore?.id && <ChatInbox storeId={activeStore.id} />}` once near the end of the component's returned JSX tree (as a sibling near the closing tag, same pattern as the original `session-list-view.tsx` mount — a fixed-position FAB, so exact placement in the tree doesn't affect layout).

- [ ] **Step 3: Smoketest**

Run: `npm run dev`. Log in as a cashier-role user and visit each of: `/dashboard`, `/pins`, `/cashier` (both the session list AND drill into a session detail), `/reservations`, `/admin/online-orders`. Confirm:
- The chat FAB appears on every one of these pages.
- It does not double-render (no two overlapping FABs) on any single page.
- Opening/replying to a chat still works identically to before (regression check).

Expected: all confirmed.

- [ ] **Step 4: Commit**

```bash
git add src/components/cashier/session-list-view.tsx src/app/cashier/page.tsx src/components/dashboard/DashboardPageClient.tsx src/app/pins/pins-client.tsx src/components/reservations/ReservationsClient.tsx src/components/admin/online-orders/OnlineOrdersClient.tsx
git commit -m "feat: show the chat bubble across all cashier-facing pages"
```

---

## Task 9: ERP — chatResponsiveness scoring dimension

**Files:**
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\lib\performance\score.ts`
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\lib\performance\score.test.ts`

**Interfaces:**
- Produces: `StaffScoreMetrics.chatResponseCount/chatWithin2MinCount/chatReceivedWhileOnDuty/chatAnsweredWhileOnDuty` (nullable-by-zero, same convention as `avgServeMs`); `ScoreWeights.chatResponsiveness`; `StaffScoreBreakdown.chatResponsiveness`. Consumed by Task 11.

- [ ] **Step 1: Write the failing tests**

Append to `score.test.ts` (after the existing dimension `describe` blocks, matching the file's established style — see the `base` fixture and `mkCohort` helper already at the top):

```ts
describe('computeStaffScore — chatResponsiveness', () => {
  it('is null when there is no chat basis at all', () => {
    const r = computeStaffScore({ ...base, chatResponseCount: 0, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0 });
    expect(r.breakdown.chatResponsiveness).toBeNull();
  });

  it('is 100 when every answered chat was within standard and every on-duty chat was answered', () => {
    const r = computeStaffScore({ ...base, chatResponseCount: 10, chatWithin2MinCount: 10, chatReceivedWhileOnDuty: 10, chatAnsweredWhileOnDuty: 10 });
    expect(r.breakdown.chatResponsiveness).toBe(100);
  });

  it('blends 80% timeliness + 20% efficiency', () => {
    // timeliness: 5/10 = 50%. efficiency: 8/10 = 80%. score = 0.8*50 + 0.2*80 = 56
    const r = computeStaffScore({ ...base, chatResponseCount: 10, chatWithin2MinCount: 5, chatReceivedWhileOnDuty: 10, chatAnsweredWhileOnDuty: 8 });
    expect(r.breakdown.chatResponsiveness).toBe(56);
  });

  it('falls back to timeliness alone when nothing was received while on duty (e.g. only rescued stale chats)', () => {
    const r = computeStaffScore({ ...base, chatResponseCount: 4, chatWithin2MinCount: 4, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0 });
    expect(r.breakdown.chatResponsiveness).toBe(100);
  });

  it('drops out of the composite when weight is 0', () => {
    const weights: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, chatResponsiveness: 0 };
    const withChat = computeStaffScore({ ...base, scheduledDays: 20, presentDays: 20, chatResponseCount: 10, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 10, chatAnsweredWhileOnDuty: 0 }, { weights });
    const withoutAnyChat = computeStaffScore({ ...base, scheduledDays: 20, presentDays: 20 }, { weights });
    expect(withChat.overall).toBe(withoutAnyChat.overall);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/performance/score.test.ts`
Expected: FAIL — `chatResponseCount does not exist on type StaffScoreMetrics` (or similar) plus `chatResponsiveness` undefined on breakdown.

- [ ] **Step 3: Implement**

In `score.ts`, extend `StaffScoreMetrics` (after `reportDays`, line 49):

```ts
  /** Chat messages this cashier personally answered (any on-duty state). 0 =>
   *  no basis for timeliness. */
  chatResponseCount: number;
  /** Of those, how many were within the 2-minute standard (using the FAIR
   *  elapsed time — see the chat-responsiveness design spec in the POS repo). */
  chatWithin2MinCount: number;
  /** Chat messages that arrived while this cashier was on duty (regardless of
   *  who answered). 0 => no basis for efficiency. */
  chatReceivedWhileOnDuty: number;
  /** Of those, how many THIS cashier personally answered. */
  chatAnsweredWhileOnDuty: number;
```

Add the scoring function (after `speedScore`, before the `StaffScoreBreakdown` interface, ~line 170):

```ts
// Chat responsiveness: 80% timeliness (answered-within-2min rate) + 20%
// efficiency (answered/received-while-on-duty rate). Absolute against the
// fixed 2-minute standard — no cohort needed, unlike speed. Either side may
// be null (no basis); both null => not applicable for this cashier.
function chatResponsivenessScore(m: StaffScoreMetrics): number | null {
  const timeliness = m.chatResponseCount > 0 ? (m.chatWithin2MinCount / m.chatResponseCount) * 100 : null;
  const efficiency = m.chatReceivedWhileOnDuty > 0 ? (m.chatAnsweredWhileOnDuty / m.chatReceivedWhileOnDuty) * 100 : null;
  if (timeliness == null && efficiency == null) return null;
  const t = timeliness ?? efficiency!;
  const e = efficiency ?? timeliness!;
  return r1(clamp(0.8 * t + 0.2 * e, 0, 100));
}
```

Extend `StaffScoreBreakdown`:

```ts
export interface StaffScoreBreakdown {
  attendance: number | null;
  conduct: number;
  accountability: number;
  advances: number;
  responsiveness: number | null;
  sales: number | null;
  speed: number | null;
  compliance: number | null;
  chatResponsiveness: number | null;
}
```

Extend `ScoreWeights` + `DEFAULT_SCORE_WEIGHTS`:

```ts
export interface ScoreWeights {
  attendance: number;
  conduct: number;
  accountability: number;
  advances: number;
  responsiveness: number;
  sales: number;
  speed: number;
  compliance: number;
  /** Cashier chat responsiveness — 80% timeliness + 20% efficiency vs the
   *  2-minute standard. No basis for staff with no chat activity. */
  chatResponsiveness: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  attendance: 25,
  conduct: 20,
  accountability: 15,
  advances: 15,
  responsiveness: 25,
  sales: 20,
  speed: 20,
  compliance: 15,
  chatResponsiveness: 15,
};
```

Wire into `computeStaffScore`'s `breakdown` object:

```ts
  const breakdown: StaffScoreBreakdown = {
    attendance: attendanceScore(metrics),
    conduct: conductScore(metrics),
    accountability: accountabilityScore(metrics),
    advances: advancesScore(metrics, cohort),
    responsiveness: responsivenessScore(metrics),
    sales: salesScore(metrics, cohort),
    speed: speedScore(metrics, cohort),
    compliance: complianceScore(metrics, cohort),
    chatResponsiveness: chatResponsivenessScore(metrics),
  };
```

(No other change needed in the weighted-average loop — it already iterates `Object.keys(weights)` generically and excludes only `compliance` by name.)

Update the `base` fixture at the top of `score.test.ts` (used by every other `describe` block) to include the four new required fields so pre-existing tests keep compiling:

```ts
const base: StaffScoreMetrics = {
  scheduledDays: 0,
  presentDays: 0,
  lateCount: 0,
  infractionPoints: 0,
  chargedAmount: 0,
  owedAmount: 0,
  responsivenessScore: null,
  salesAmount: 0,
  salesTxCount: 0,
  salesDays: 0,
  avgServeMs: null,
  avgConfirmMs: null,
  reportDays: 0,
  chatResponseCount: 0,
  chatWithin2MinCount: 0,
  chatReceivedWhileOnDuty: 0,
  chatAnsweredWhileOnDuty: 0,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/performance/score.test.ts`
Expected: PASS — all pre-existing tests plus the 5 new ones.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (this will surface any other `StaffScoreMetrics` literal in the codebase that needs the 4 new required fields — fix each one found, e.g. `staff-perf-month.ts`'s manager-row construction, which Task 11 handles).

- [ ] **Step 6: Commit**

```bash
git add src/lib/performance/score.ts src/lib/performance/score.test.ts
git commit -m "feat: add chatResponsiveness scoring dimension (80% timeliness + 20% efficiency)"
git push origin HEAD:upgrade-next16
```

(Per this repo's convention: push to both the current feature branch and `upgrade-next16`.)

---

## Task 10: ERP — weight config plumbing + UI

**Files:**
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\types\index.ts:2670-2686` (`PerformanceWeights`)
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\lib\performance\config.ts`
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\app\manager\staff-hub\performance-config\page.tsx`

**Interfaces:**
- Consumes: `ScoreWeights.chatResponsiveness` (Task 9).
- Produces: manager-tunable weight surfaced in `PerformanceWeights`, defaulted/clamped by `resolvePerformanceConfig`, editable in the performance-config UI.

- [ ] **Step 1: Add the field to `PerformanceWeights`**

```ts
// src/types/index.ts, inside the PerformanceWeights interface (after responsiveness)
  /** Cashier chat responsiveness (website live chat). Green zone, on by
   *  default. No basis for staff with no chat activity or for managers. */
  chatResponsiveness: number;
```

- [ ] **Step 2: Wire the default + resolver**

```ts
// src/lib/performance/config.ts
export const DEFAULT_PERFORMANCE_WEIGHTS: ScoreWeights = {
  attendance: 25,
  sales: 20,
  speed: 20,
  compliance: 15,
  conduct: 0,
  accountability: 0,
  advances: 0,
  responsiveness: 25,
  chatResponsiveness: 15,
};
```

```ts
// inside resolvePerformanceConfig's returned `weights` object, add:
      chatResponsiveness: doc?.weights ? clamp0to100(w.chatResponsiveness) : DEFAULT_PERFORMANCE_WEIGHTS.chatResponsiveness,
```

- [ ] **Step 3: Add the UI row**

```ts
// performance-config/page.tsx — add to the GREEN array (it's cashier-facing and POS-linked, like sales/speed)
const GREEN: { key: MetricKey; label: string; desc: string; pos?: boolean }[] = [
  { key: 'attendance', label: 'Attendance', desc: 'Present days and punctuality.' },
  { key: 'sales', label: 'Sales', desc: 'POS sales rung, ranked against peers.', pos: true },
  { key: 'speed', label: 'Service speed', desc: 'Kitchen serve + server confirm times, ranked against peers.', pos: true },
  { key: 'chatResponsiveness', label: 'Chat responsiveness', desc: 'Website live-chat replies: % answered within 2 minutes, plus % of chats received on-shift that got answered.', pos: true },
  { key: 'compliance', label: 'Report compliance', desc: 'Bonus points for submitting the daily checklist + usage reports (vs the top submitter). Added on top of the score — it can only help, never lower anyone.' },
];
```

```ts
// add to DEFAULT_ON
const DEFAULT_ON: PerformanceWeights = { attendance: 25, sales: 20, speed: 20, compliance: 15, conduct: 20, accountability: 15, advances: 15, responsiveness: 25, chatResponsiveness: 15 };
```

- [ ] **Step 4: Smoketest**

Run: `npm run dev` (ERP, port 9002). Visit `/manager/staff-hub/performance-config` as a manager/admin. Confirm:
- A new "Chat responsiveness" slider row appears in the green zone.
- Toggling it off/on and saving persists correctly (check `stores/{storeId}/performanceConfig/meta` in Firestore).
- The relative-percentage total (`rel(k)`) still sums sensibly with the new dimension included.

Expected: all confirmed, no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/performance/config.ts "src/app/manager/staff-hub/performance-config/page.tsx"
git commit -m "feat: add chatResponsiveness to the performance weight config + UI"
git push origin HEAD:upgrade-next16
```

---

## Task 11: ERP — pull chat metrics into the monthly projection

**Files:**
- Modify: `C:\Users\ianla\webapps\ERP-rebuild\src\lib\server\projections\staff-perf-month.ts`

**Interfaces:**
- Consumes: `chatResponseMsSum/chatResponseCount/chatWithin2MinCount/chatReceivedWhileOnDuty/chatAnsweredWhileOnDuty` on the POS `/api/external/staff-metrics` response (Task 6).
- Produces: `StaffScoreMetrics.chatResponseCount` etc. populated for both staff and manager rows (Task 9's fields).

- [ ] **Step 1: Extend `Accum` + `emptyAccum` + `PosAccum`**

```ts
// Accum interface (after posSalesDays)
  chatResponseCount: number; chatWithin2MinCount: number;
  chatReceivedWhileOnDuty: number; chatAnsweredWhileOnDuty: number;
```

```ts
// emptyAccum()
const emptyAccum = (): Accum => ({
  presentDays: new Set(), absentDays: new Set(), lateCount: 0,
  infractionPoints: 0, chargedAmount: 0,
  serveMsSum: 0, serveCount: 0, confirmMsSum: 0, confirmCount: 0,
  posSalesRung: 0, posTxCount: 0, posSalesDays: new Set(),
  reportDayKeys: new Set(),
  chatResponseCount: 0, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0,
});
```

```ts
type PosAccum = {
  serveMsSum: number; serveCount: number; confirmMsSum: number; confirmCount: number;
  salesAmount: number; txCount: number; salesDays: Set<string>;
  chatResponseCount: number; chatWithin2MinCount: number; chatReceivedWhileOnDuty: number; chatAnsweredWhileOnDuty: number;
};
```

- [ ] **Step 2: Fold the new fields into `collectPosStaffMetrics`**

In the `results.forEach` loop (around line 148), extend the accumulator seed and increments:

```ts
      const acc = out.get(staffId) ?? {
        serveMsSum: 0, serveCount: 0, confirmMsSum: 0, confirmCount: 0, salesAmount: 0, txCount: 0, salesDays: new Set<string>(),
        chatResponseCount: 0, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0,
      };
      acc.serveMsSum += num(m.serveMsSum);
      acc.serveCount += num(m.serveCount);
      acc.confirmMsSum += num(m.confirmMsSum);
      acc.confirmCount += num(m.confirmCount);
      acc.chatResponseCount += num(m.chatResponseCount);
      acc.chatWithin2MinCount += num(m.chatWithin2MinCount);
      acc.chatReceivedWhileOnDuty += num(m.chatReceivedWhileOnDuty);
      acc.chatAnsweredWhileOnDuty += num(m.chatAnsweredWhileOnDuty);
```

(`chatResponseMsSum` from the API isn't needed here — ERP's `chatResponsivenessScore` only needs counts, not the raw ms sum; POS's own printed report is the one that shows an average duration.)

- [ ] **Step 3: Fold into the per-staff accumulator merge**

Where `posMetrics` gets folded into `a` (around line 350-357):

```ts
  for (const [staffId, pm] of posMetrics) {
    const a = bump(staffId); if (!a) continue;
    a.serveMsSum += pm.serveMsSum; a.serveCount += pm.serveCount;
    a.confirmMsSum += pm.confirmMsSum; a.confirmCount += pm.confirmCount;
    a.posSalesRung += pm.salesAmount; a.posTxCount += pm.txCount;
    for (const dk of pm.salesDays) a.posSalesDays.add(dk);
    a.chatResponseCount += pm.chatResponseCount; a.chatWithin2MinCount += pm.chatWithin2MinCount;
    a.chatReceivedWhileOnDuty += pm.chatReceivedWhileOnDuty; a.chatAnsweredWhileOnDuty += pm.chatAnsweredWhileOnDuty;
    if (pm.serveCount > 0 || pm.confirmCount > 0 || pm.txCount > 0) posDataPresent = true;
  }
```

- [ ] **Step 4: Populate `StaffScoreMetrics` for staff rows**

In the `rows = roster.map(...)` block (around line 379-388):

```ts
    const metrics: StaffScoreMetrics = {
      scheduledDays, presentDays, lateCount: a.lateCount,
      infractionPoints: a.infractionPoints, chargedAmount: a.chargedAmount,
      owedAmount: owedByStaff.get(s.id) ?? 0,
      responsivenessScore: null,
      salesAmount: a.posSalesRung, salesTxCount: a.posTxCount, salesDays: a.posSalesDays.size,
      avgServeMs, avgConfirmMs,
      reportDays,
      chatResponseCount: a.chatResponseCount, chatWithin2MinCount: a.chatWithin2MinCount,
      chatReceivedWhileOnDuty: a.chatReceivedWhileOnDuty, chatAnsweredWhileOnDuty: a.chatAnsweredWhileOnDuty,
    };
```

- [ ] **Step 5: Populate `StaffScoreMetrics` for manager rows**

In the `managerEntries = managerStaff.map(...)` block (around line 447-454), managers get zero chat activity (same treatment as `salesAmount: 0`):

```ts
    const metrics: StaffScoreMetrics = {
      scheduledDays, presentDays, lateCount: a.lateCount,
      infractionPoints: a.infractionPoints, chargedAmount: a.chargedAmount,
      owedAmount: owedByStaff.get(s.id) ?? 0,
      responsivenessScore: s.linkedUserUid ? (oilByUid.get(s.linkedUserUid) ?? null) : null,
      salesAmount: 0, salesTxCount: 0, salesDays: 0, avgServeMs: null, avgConfirmMs: null,
      reportDays: a.reportDayKeys.size,
      chatResponseCount: 0, chatWithin2MinCount: 0, chatReceivedWhileOnDuty: 0, chatAnsweredWhileOnDuty: 0,
    };
```

- [ ] **Step 6: Typecheck + run the existing purge-guard test**

Run: `npm run typecheck`
Run: `npx vitest run src/lib/server/projections/staff-perf-month.purge-guard.test.ts`
Expected: both pass — this confirms the `StaffScoreMetrics` literal changes didn't break existing callers.

- [ ] **Step 7: Smoketest end-to-end**

With both repos' dev servers running and a store that has `posStoreId` linking ERP↔POS and at least one staff mapped via `posProfileId`, trigger a rebuild (however this repo normally re-runs `buildAndWriteStaffPerfMonth` — check `/api/cron/rebuild-performance` or the manager UI's rebuild action) for the month containing the Task 5 smoketest's seeded chat reply. Confirm on `/performance/team` that the cashier who answered shows a non-null chat-responsiveness contribution, and their score changed relative to before this feature (if the dimension's weight is > 0).

Expected: confirmed.

- [ ] **Step 8: Commit and push**

```bash
git add src/lib/server/projections/staff-perf-month.ts
git commit -m "feat: pull chat responsiveness metrics into the monthly performance projection"
git push origin HEAD:upgrade-next16
```

---

## Final wrap-up

- [ ] Run POS's full check: `npm run build` in `C:\Users\ianla\webapps\POS` (with the dev server stopped first — building while dev is running clobbers `.next`, see `reference_next_build_clobbers_dev_server`). Fix any failures before proceeding.
- [ ] Run ERP's full gate: `npm run typecheck && npm run lint:routing && npm run test` in `C:\Users\ianla\webapps\ERP-rebuild`.
- [ ] Push POS: `git push origin sev5_advanced` (this session has an explicit ask to push, per the user's original request — this repo's normal default is "Ian pushes," overridden this session).
- [ ] Confirm ERP-rebuild pushes already landed on both the feature branch and `upgrade-next16` (done per-task above; verify with `git log origin/upgrade-next16 -3`).
- [ ] No Shareat Website changes were made — nothing to push there.
