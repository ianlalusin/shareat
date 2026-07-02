# Kitchen Bluetooth Printer Backup (Offline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During an internet outage, the cashier and server/refill devices auto-print kitchen tickets to a shared Bluetooth thermal printer — but only for designated kitchen locations — reusing the existing BT plugin (no native code).

**Architecture:** A pure `formatKitchenTicket` produces ESC/POS text; `printKitchenTicketBackup` gates (offline + location flagged + printer paired), prints via the existing BT path with retry, stamps the ticket `printedOffline`, and alerts the cashier on final failure. The Plan 5 offline ticket-creation branches call it fire-and-forget. Online behavior (KDS screen) is unchanged; on reconnect the KDS auto-acknowledges `printedOffline` tickets.

**Tech Stack:** TypeScript, Firebase JS SDK v10, Capacitor (existing `ThermalPrinter` BT plugin), Next.js client, Vitest (node).

## Global Constraints

- Node `>=20 <21`. Vitest node env, glob `src/**/*.test.ts`, alias `@` → `./src`. Pure-unit-test pattern (injected deps/fakes). No new runtime dependencies. Browser modules start with `"use client";`.
- **No native/Java changes** — reuse `ThermalPrinter` (Bluetooth) and `printHub`'s connect→print→disconnect pattern.
- Reuse (merged): `useOnlineStatus` (Plan 4), device id `getBrowserDeviceId` (Plan 2), `commitLocalFirst` (Plan 1).
- **Printing is fire-and-forget** — it must never block or throw into the order/ticket-creation flow.
- Kitchen printer address is stored under a **separate** localStorage key `kitchen_printer_address` (NOT the receipt printer's `last_printer_address`).
- Print only when **offline** AND the ticket's location has `printOnOutage === true` AND a kitchen printer is paired on this device.
- On successful print, stamp the ticket `printedOffline: true`, `printedOfflineAt: <clientMs>`, `printedOfflineDevice: <deviceId>` (local-first, not awaited).
- Print failure = **retry (default 3 attempts, 400ms apart), then alert the cashier**; the order/ticket still records.
- Typecheck: `npm run typecheck`. **Testing:** pure `formatKitchenTicket` + the gate/retry logic of `printKitchenTicketBackup` are TDD'd in Node with injected deps; the BT/native, UI, and KDS surfaces are verified by the **on-device protocol** (Task 8).

---

### Task 1: `formatKitchenTicket` (pure ESC/POS formatter)

**Files:**
- Create: `src/lib/printing/kitchenTicketFormatter.ts`
- Test: `src/lib/printing/kitchenTicketFormatter.test.ts`

**Interfaces:**
- Produces:
  - `export interface KitchenTicketPrintData { stationName: string; tableOrCustomer: string; itemName: string; qty: number; modifiersText?: string | null; notes?: string | null; timeText: string; }`
  - `export function formatKitchenTicket(d: KitchenTicketPrintData, width?: 58 | 80): string`

- [ ] **Step 1: Write the failing test** (`kitchenTicketFormatter.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { formatKitchenTicket } from "@/lib/printing/kitchenTicketFormatter";

const base = {
  stationName: "GRILL",
  tableOrCustomer: "TABLE 5",
  itemName: "Beef Platter",
  qty: 2,
  timeText: "14:32",
};

describe("formatKitchenTicket", () => {
  it("includes the OFFLINE header, station, table, and qty x item", () => {
    const t = formatKitchenTicket(base);
    expect(t).toContain("*** OFFLINE ***");
    expect(t).toContain("GRILL");
    expect(t).toContain("TABLE 5");
    expect(t).toContain("2 x Beef Platter");
    expect(t).toContain("14:32");
  });

  it("includes modifiers and notes when present", () => {
    const t = formatKitchenTicket({ ...base, modifiersText: "extra sauce", notes: "no onions" });
    expect(t).toContain("extra sauce");
    expect(t).toContain("no onions");
  });

  it("omits the note line when notes are absent", () => {
    const t = formatKitchenTicket(base);
    expect(t).not.toContain("Note:");
  });

  it("ends with a newline so the printer flushes the last line", () => {
    expect(formatKitchenTicket(base).endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/printing/kitchenTicketFormatter.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/printing/kitchenTicketFormatter.ts`.**

```ts
"use client";

export interface KitchenTicketPrintData {
  stationName: string;
  tableOrCustomer: string;
  itemName: string;
  qty: number;
  modifiersText?: string | null;
  notes?: string | null;
  timeText: string;
}

/**
 * Builds plain-text ESC/POS content for an OFFLINE kitchen ticket (one item per
 * ticket, matching createKitchenTickets). Kitchen tickets are prep instructions,
 * not receipts — deliberately minimal: OFFLINE header, station, table/customer,
 * the item x qty, optional modifiers/notes, and the time.
 */
export function formatKitchenTicket(
  d: KitchenTicketPrintData,
  width: 58 | 80 = 80,
): string {
  const cols = width === 58 ? 32 : 48;
  const hr = "-".repeat(cols);
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((cols - s.length) / 2));
    return " ".repeat(pad) + s;
  };

  const lines: string[] = [];
  lines.push(center("*** OFFLINE ***"));
  lines.push(center(d.stationName.toUpperCase()));
  lines.push(hr);
  lines.push(d.tableOrCustomer);
  lines.push("");
  lines.push(`${d.qty} x ${d.itemName}`);
  if (d.modifiersText && d.modifiersText.trim()) lines.push(`  + ${d.modifiersText.trim()}`);
  if (d.notes && d.notes.trim()) lines.push(`  Note: ${d.notes.trim()}`);
  lines.push("");
  lines.push(hr);
  lines.push(d.timeText);
  lines.push("");

  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/printing/kitchenTicketFormatter.test.ts` → PASS (4).

- [ ] **Step 5: Commit** (standard trailer lines)
```bash
git add src/lib/printing/kitchenTicketFormatter.ts src/lib/printing/kitchenTicketFormatter.test.ts
git commit -m "feat(print): pure kitchen-ticket ESC/POS formatter"
```

---

### Task 2: `printKitchenTicketBackup` (gate + retry + stamp)

**Files:**
- Create: `src/lib/printing/kitchenBackupPrint.ts`
- Test: `src/lib/printing/kitchenBackupPrint.test.ts`

**Interfaces:**
- Consumes: `formatKitchenTicket`, `KitchenTicketPrintData` (Task 1).
- Produces:
  - `export interface KitchenTicketDoc { id: string; kitchenLocationId: string | null; kitchenLocationName?: string | null; itemName: string; qty?: number; qtyOrdered?: number; tableNumber?: unknown; tableDisplayName?: string | null; customerName?: string | null; sessionMode?: string; modifiersText?: string | null; notes?: string | null; widthMm?: 58 | 80; }`
  - `export interface BackupPrintDeps { isOnline: () => boolean; getKitchenPrinterAddress: () => string | null; locationPrintsOnOutage: (kitchenLocationId: string | null) => boolean; printText: (text: string, widthMm: 58 | 80) => Promise<void>; onStamp: (ticketId: string) => void; onAlert: (message: string) => void; now?: () => Date; sleep?: (ms: number) => Promise<void>; maxAttempts?: number; delayMs?: number; }`
  - `export async function printKitchenTicketBackup(ticket: KitchenTicketDoc, deps: BackupPrintDeps): Promise<"printed" | "skipped" | "failed">`

- [ ] **Step 1: Write the failing tests** (`kitchenBackupPrint.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { printKitchenTicketBackup, type KitchenTicketDoc, type BackupPrintDeps } from "@/lib/printing/kitchenBackupPrint";

function ticket(over: Partial<KitchenTicketDoc> = {}): KitchenTicketDoc {
  return { id: "t1", kitchenLocationId: "grill", kitchenLocationName: "Grill", itemName: "Beef", qty: 2, tableDisplayName: "Table 5", sessionMode: "package_dinein", ...over };
}
function deps(over: Partial<BackupPrintDeps> = {}): BackupPrintDeps {
  return {
    isOnline: () => false,
    getKitchenPrinterAddress: () => "AA:BB",
    locationPrintsOnOutage: () => true,
    printText: vi.fn(async () => {}),
    onStamp: vi.fn(),
    onAlert: vi.fn(),
    now: () => new Date(2026, 6, 2, 14, 32, 0),
    sleep: async () => {},
    maxAttempts: 3,
    delayMs: 0,
    ...over,
  };
}

describe("printKitchenTicketBackup", () => {
  it("skips when online", async () => {
    const d = deps({ isOnline: () => true });
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("skipped");
    expect(d.printText).not.toHaveBeenCalled();
  });
  it("skips when no kitchen printer is paired", async () => {
    const d = deps({ getKitchenPrinterAddress: () => null });
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("skipped");
    expect(d.printText).not.toHaveBeenCalled();
  });
  it("skips when the location is not flagged to print", async () => {
    const d = deps({ locationPrintsOnOutage: () => false });
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("skipped");
    expect(d.printText).not.toHaveBeenCalled();
  });
  it("prints and stamps on success", async () => {
    const d = deps();
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("printed");
    expect(d.printText).toHaveBeenCalledTimes(1);
    expect(d.onStamp).toHaveBeenCalledWith("t1");
    expect(d.onAlert).not.toHaveBeenCalled();
  });
  it("retries then alerts (not stamped) after all attempts fail", async () => {
    const printText = vi.fn(async () => { throw new Error("busy"); });
    const d = deps({ printText });
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("failed");
    expect(printText).toHaveBeenCalledTimes(3);
    expect(d.onAlert).toHaveBeenCalledTimes(1);
    expect(d.onStamp).not.toHaveBeenCalled();
  });
  it("succeeds after a transient failure (retry)", async () => {
    let n = 0;
    const printText = vi.fn(async () => { if (++n < 2) throw new Error("busy"); });
    const d = deps({ printText });
    expect(await printKitchenTicketBackup(ticket(), d)).toBe("printed");
    expect(printText).toHaveBeenCalledTimes(2);
    expect(d.onStamp).toHaveBeenCalledWith("t1");
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/printing/kitchenBackupPrint.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/lib/printing/kitchenBackupPrint.ts`.**

```ts
"use client";

import { formatKitchenTicket, type KitchenTicketPrintData } from "@/lib/printing/kitchenTicketFormatter";

export interface KitchenTicketDoc {
  id: string;
  kitchenLocationId: string | null;
  kitchenLocationName?: string | null;
  itemName: string;
  qty?: number;
  qtyOrdered?: number;
  tableNumber?: unknown;
  tableDisplayName?: string | null;
  customerName?: string | null;
  sessionMode?: string;
  modifiersText?: string | null;
  notes?: string | null;
  widthMm?: 58 | 80;
}

export interface BackupPrintDeps {
  isOnline: () => boolean;
  getKitchenPrinterAddress: () => string | null;
  locationPrintsOnOutage: (kitchenLocationId: string | null) => boolean;
  printText: (text: string, widthMm: 58 | 80) => Promise<void>;
  onStamp: (ticketId: string) => void;
  onAlert: (message: string) => void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  delayMs?: number;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function tableOrCustomer(t: KitchenTicketDoc): string {
  if (t.sessionMode === "alacarte") return `CUSTOMER: ${t.customerName ?? "Walk-in"}`;
  return t.tableDisplayName || (t.tableNumber != null ? `TABLE ${t.tableNumber}` : "TABLE");
}

/**
 * Prints one offline kitchen ticket to the shared Bluetooth kitchen printer, IF
 * this device is offline, the ticket's location is flagged printOnOutage, and a
 * kitchen printer is paired. Retries on failure, then alerts the cashier. On
 * success, stamps the ticket printedOffline. Never throws — printing must not
 * break the order flow.
 */
export async function printKitchenTicketBackup(
  ticket: KitchenTicketDoc,
  deps: BackupPrintDeps,
): Promise<"printed" | "skipped" | "failed"> {
  if (deps.isOnline()) return "skipped";
  const address = deps.getKitchenPrinterAddress();
  if (!address) return "skipped";
  if (!deps.locationPrintsOnOutage(ticket.kitchenLocationId)) return "skipped";

  const now = (deps.now ?? (() => new Date()))();
  const data: KitchenTicketPrintData = {
    stationName: ticket.kitchenLocationName || "KITCHEN",
    tableOrCustomer: tableOrCustomer(ticket),
    itemName: ticket.itemName,
    qty: ticket.qty ?? ticket.qtyOrdered ?? 1,
    modifiersText: ticket.modifiersText,
    notes: ticket.notes,
    timeText: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  };
  const widthMm = ticket.widthMm ?? 80;
  const text = formatKitchenTicket(data, widthMm);

  const maxAttempts = deps.maxAttempts ?? 3;
  const delayMs = deps.delayMs ?? 400;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await deps.printText(text, widthMm);
      deps.onStamp(ticket.id);
      return "printed";
    } catch {
      if (attempt < maxAttempts) await sleep(delayMs);
    }
  }
  deps.onAlert(`Kitchen printer unreachable — deliver "${data.itemName}" to ${data.stationName} manually.`);
  return "failed";
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/printing/kitchenBackupPrint.test.ts` → PASS (6).

- [ ] **Step 5: Commit** (trailer lines)
```bash
git add src/lib/printing/kitchenBackupPrint.ts src/lib/printing/kitchenBackupPrint.test.ts
git commit -m "feat(print): offline kitchen-ticket backup print (gate + retry + stamp)"
```

---

### Task 3: Kitchen-printer address storage + BT print binding

**Files:**
- Create: `src/lib/printing/kitchenPrinter.ts`
- Modify: `src/lib/printing/printHub.ts` — parameterize `printViaNativeBluetooth` to accept an optional printer address.

**Interfaces:**
- Produces:
  - `export function getKitchenPrinterAddress(): string | null`
  - `export function setKitchenPrinterAddress(address: string): void`
  - `export async function printKitchenText(text: string, widthMm: 58 | 80): Promise<void>`

- [ ] **Step 1: Parameterize `printViaNativeBluetooth`.**
In `printHub.ts`, change its signature to accept an optional address defaulting to the current behavior:
```ts
export async function printViaNativeBluetooth(
  job: Required<Pick<PrintJob, 'text'>> & PrintJob,
  address: string | null = getLastPrinterAddress(),
) {
```
and inside, replace `const lastAddress = getLastPrinterAddress();` with `const lastAddress = address;` (keep the `if (!lastAddress) throw …` guard). Nothing else changes — existing callers pass no second arg and keep receipt-printer behavior.

- [ ] **Step 2: Create `src/lib/printing/kitchenPrinter.ts`.**
```ts
"use client";

import { printViaNativeBluetooth } from "@/lib/printing/printHub";

const KEY = "kitchen_printer_address";

export function getKitchenPrinterAddress(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setKitchenPrinterAddress(address: string): void {
  try { localStorage.setItem(KEY, address); } catch {}
}

/** Prints plain ESC/POS text to the paired kitchen Bluetooth printer. */
export async function printKitchenText(text: string, widthMm: 58 | 80): Promise<void> {
  await printViaNativeBluetooth(
    { text, widthMm, cut: true, beep: true },
    getKitchenPrinterAddress(),
  );
}
```

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS. Confirm existing `printViaNativeBluetooth(...)` callers still compile (address param is optional).

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add src/lib/printing/kitchenPrinter.ts src/lib/printing/printHub.ts
git commit -m "feat(print): kitchen-printer address storage + BT binding"
```

---

### Task 4: `createKitchenTickets` returns its payload + `printOnOutage` type

**Files:**
- Modify: `src/components/cashier/firestore.ts` — `createKitchenTickets` returns the ticket payload it built.
- Modify: `src/lib/types.ts` — add `printOnOutage?` to `KitchenLocation`.

**Interfaces:**
- Produces: `createKitchenTickets(...)` now returns `Promise<Record<string, any> | null>` (the ticket payload, or `null` when it early-returns because the item has no kitchen station).

- [ ] **Step 1: Add the type field.**
In `src/lib/types.ts`, inside `export type KitchenLocation = { … }`, add:
```ts
  /** When true, this location's tickets print to the shared Bluetooth kitchen
   *  printer during an internet outage (offline backup). Absent → false. */
  printOnOutage?: boolean;
```

- [ ] **Step 2: Return the payload from `createKitchenTickets`.**
In `firestore.ts` `createKitchenTickets`: change the early `if (!stationId) return;` to `if (!stationId) return null;`. At the very end (after the `writer.update(rtKdsDocRef, …)` block) add `return ticketPayload;`. Set the return type to `Promise<Record<string, any> | null>` if TS requires it. Do NOT change any write logic or payload.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS. Online callers ignore the return value.

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add src/components/cashier/firestore.ts src/lib/types.ts
git commit -m "feat(offline): createKitchenTickets returns its payload; KitchenLocation.printOnOutage"
```

---

### Task 5: Production deps + wire the backup print into the offline branches

**Files:**
- Create: `src/lib/printing/kitchenBackupDeps.ts`
- Modify: `AddonsPOSModal.tsx`, `RefillPOSModal.tsx` (both offline branches), `session-detail-view.tsx` (offline branch), and `startSession`'s package-ticket path in `firestore.ts`.

**Interfaces:**
- Consumes: `printKitchenTicketBackup` (Task 2), `getKitchenPrinterAddress`/`printKitchenText` (Task 3), `createKitchenTickets` return (Task 4).
- Produces: `export function makeKitchenBackupDeps(args: { kitchenLocations: { id: string; printOnOutage?: boolean }[]; stampTicket: (ticketId: string) => void; alert: (message: string) => void; }): BackupPrintDeps`

- [ ] **Step 1: Create `src/lib/printing/kitchenBackupDeps.ts`.**
```ts
"use client";

import type { BackupPrintDeps } from "@/lib/printing/kitchenBackupPrint";
import { getKitchenPrinterAddress, printKitchenText } from "@/lib/printing/kitchenPrinter";

/**
 * Builds the production BackupPrintDeps. `isOnline` is intentionally always
 * false here: this is only called from the OFFLINE ticket-creation branches,
 * so the online guard is a defensive no-op. Callers supply the store's kitchen
 * locations (for printOnOutage), a stamp callback (local-first ticket update),
 * and an alert callback (cashier toast).
 */
export function makeKitchenBackupDeps(args: {
  kitchenLocations: { id: string; printOnOutage?: boolean }[];
  stampTicket: (ticketId: string) => void;
  alert: (message: string) => void;
}): BackupPrintDeps {
  const flagById = new Map(args.kitchenLocations.map((l) => [l.id, !!l.printOnOutage]));
  return {
    isOnline: () => false,
    getKitchenPrinterAddress,
    locationPrintsOnOutage: (id) => (id ? flagById.get(id) === true : false),
    printText: printKitchenText,
    onStamp: args.stampTicket,
    onAlert: args.alert,
  };
}
```

- [ ] **Step 2: Wire into each offline branch (fire-and-forget).**
In each offline branch, capture `createKitchenTickets(...)`'s returned payload and, AFTER `commitLocalFirst(batch, …)`, print it. The `stampTicket` callback does a local-first `updateDoc` of the ticket. Shape (adapt variable names per file; `kitchenLocations` comes from the component's store config, `toast` from the existing hook, `db`/`storeId`/`sessionId` in scope):
```ts
const ticketPayload = await createKitchenTickets(db, storeId, sessionId, session, "addon", { /* line */ }, qty, actor, { batch });
commitLocalFirst(batch, (err) => console.error("[...] offline sync failed", err));
if (ticketPayload) {
  const deps = makeKitchenBackupDeps({
    kitchenLocations,
    stampTicket: (ticketId) => {
      const ref = doc(db, "stores", storeId, "sessions", sessionId, "kitchentickets", ticketId);
      void updateDoc(ref, { printedOffline: true, printedOfflineAt: Date.now(), printedOfflineDevice: getBrowserDeviceId() }).catch(() => {});
    },
    alert: (message) => toast({ variant: "destructive", title: "Kitchen printer", description: message }),
  });
  void printKitchenTicketBackup(ticketPayload as any, deps); // fire-and-forget
}
```
Apply to: `AddonsPOSModal.tsx` offline branch; both `RefillPOSModal.tsx` offline branches (print EACH created ticket in the loop); `session-detail-view.tsx` offline branch (addon ticket); and `startSession`'s package-ticket path (gate the print on `!navigator.onLine` there — `startSession` has no React `isOnline`). Where the component doesn't already have the store's `kitchenLocations`, read them from the store-config hook it already uses (e.g. `useStoreConfigDoc`) or a `kitchenLocations` snapshot it subscribes to. Import `printKitchenTicketBackup`, `makeKitchenBackupDeps`, `getBrowserDeviceId`, and `updateDoc`.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS. Confirm printing is `void`-fired everywhere (never awaited into the order flow) and only in offline branches.

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add src/lib/printing/kitchenBackupDeps.ts src/components/shared/AddonsPOSModal.tsx src/components/server/RefillPOSModal.tsx src/components/cashier/session-detail-view.tsx src/components/cashier/firestore.ts
git commit -m "feat(print): auto-print kitchen tickets to BT printer in offline branches"
```

> On-device verification is Task 8 (all print paths tested together).

---

### Task 6: Admin `printOnOutage` toggle + kitchen-printer pairing UI

**Files:**
- Modify: `src/app/admin/stores/page.tsx` — a per-kitchen-location `printOnOutage` toggle.
- Modify: `src/app/settings/page.tsx` — a "Kitchen printer" pairing section.

- [ ] **Step 1: Add the `printOnOutage` toggle.**
In the admin stores page's kitchen-locations editor, add a switch/checkbox per location bound to `printOnOutage`, persisted to `stores/{storeId}/kitchenLocations/{id}` alongside the existing fields (`name`, `sortOrder`, `isActive`, `slaMinutes`). Follow the existing pattern used to edit those fields — do not restructure the editor.

- [ ] **Step 2: Add the kitchen-printer pairing UI.**
In `src/app/settings/page.tsx`, add a "Kitchen printer" section mirroring the existing receipt-printer pairing (which lists BT printers via `ThermalPrinter.listBluetoothPrinters()` and stores the chosen address). Differences: read/write via `getKitchenPrinterAddress()`/`setKitchenPrinterAddress()` (Task 3), and a "Test print" button that calls `printKitchenText("*** KITCHEN TEST ***\n\n\n", 80)`. Reuse the existing printer-list logic; do not duplicate the BT enumeration.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add src/app/admin/stores/page.tsx src/app/settings/page.tsx
git commit -m "feat(print): admin printOnOutage toggle + kitchen-printer pairing UI"
```

---

### Task 7: KDS auto-acknowledge of `printedOffline` tickets

**Files:**
- Modify: the kitchen/KDS page and/or its ticket-loading logic (find via `grep -rn "rtKdsTickets\|kitchentickets" src/app src/components | grep -i kitchen`).

- [ ] **Step 1: Locate the KDS ticket rendering + the existing serve action.**
Find where the kitchen page reads active tickets (status `preparing`/`ready`) and renders the prep queue, and the existing "mark served" handler (the KDS already serves tickets — Plan 3's payment flow marks tickets `served`).

- [ ] **Step 2: Auto-acknowledge on sync.**
When a ticket arrives with `printedOffline === true` and status still `preparing`/`ready`, mark it **served** via the existing serve path, using `printedOfflineAt` as the serve timestamp (so served counts/durations stay consistent), and exclude it from the active prep/alerting queue (render it in a "printed offline (done)" area or omit from the active list). Idempotent — only once per ticket (guard on not-already-served). Reuse the existing serve function; do not invent a parallel state.

- [ ] **Step 3: Typecheck** — `npm run typecheck` → PASS.

- [ ] **Step 4: Commit** (trailer lines)
```bash
git add -A
git commit -m "feat(kds): auto-acknowledge offline-printed kitchen tickets on sync"
```

---

### Task 8: On-device acceptance protocol (MANDATORY — the test for Tasks 3–7)

- [ ] **Step 1: Verify end-to-end on the APK.**
Build/install the APK (`npm run build:cap`). Pair one BT thermal printer to BOTH devices via Settings → Kitchen printer; flag at least one kitchen location `printOnOutage` in admin. Record PASS/FAIL:
1. **Offline**, from the cashier, add an item/addon whose location is flagged → the ticket auto-prints (OFFLINE header, station, table, item×qty). From the server/refill device, order a refill → it prints too (devices take turns on the one printer).
2. Order for a location NOT flagged → **no print** (billed/ticketed as normal).
3. Power the printer OFF, order offline → after retries, the **cashier gets the "deliver manually" alert**; the order/ticket still records.
4. A device with **no kitchen printer paired** → order offline → no print, no crash.
5. **Reconnect** → offline tickets sync; the **KDS auto-acknowledges** them (they don't flood the active prep queue; shown as printed-offline/done); no double-prep.
6. **Online** (normal): ordering does **not** print to the kitchen printer (KDS screen as usual).

If any step FAILS, report BLOCKED with specifics.

---

## Self-Review

**Spec coverage:**
- BT transport reuse, offline-only (spec §2–3) → Tasks 2, 3, 5. ✅
- `formatKitchenTicket` (spec §4.1) → Task 1. ✅
- `printKitchenTicketBackup` gate/retry/stamp/alert (spec §4.2, §5, §6) → Task 2. ✅
- `createKitchenTickets` returns payload (spec §4.3) → Task 4. ✅
- Trigger at offline creation sites (spec §4.4) → Task 5. ✅
- Per-location `printOnOutage` + admin toggle (spec §4.5) → Tasks 4, 6. ✅
- Kitchen-printer pairing (spec §4.6) → Tasks 3, 6. ✅
- KDS auto-acknowledge (spec §4.7, §7) → Task 7. ✅
- Retry-then-alert, no-printer skip (spec §6) → Task 2. ✅
- On-device verification (spec §8) → Task 8. ✅

**Placeholder scan:** Tasks 1–4 carry full code + tests. Tasks 5–7 give exact wiring + concrete shapes and instruct mirroring existing patterns (rather than reproducing large UI files that would drift) + a concrete on-device protocol. No hand-waving.

**Type/behavior consistency:** `KitchenTicketPrintData`/`formatKitchenTicket` (Task 1) → `printKitchenTicketBackup` (Task 2). `BackupPrintDeps`/`KitchenTicketDoc` (Task 2) → `makeKitchenBackupDeps` (Task 5). `getKitchenPrinterAddress`/`printKitchenText` (Task 3) → Task 5 deps. `createKitchenTickets` return (Task 4) → Task 5. `printOnOutage` defined Task 4, set Task 6, read Task 5. Stamp fields written Task 5, read Task 7. ✅

**Risk notes:** (1) Task 5 touches several modals — printing is always `void`-fired so a print bug can't break ordering. (2) Task 7 reuses the existing serve path to avoid analytics drift; keep the change minimal. (3) `startSession`'s package-ticket print gates on `navigator.onLine` (no React `isOnline` there) — acceptable; the modal branches use Plan-4 `useOnlineStatus`.
