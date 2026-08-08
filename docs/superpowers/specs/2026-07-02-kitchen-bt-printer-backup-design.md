# Kitchen Bluetooth Printer Backup (Offline) — Design

**Date:** 2026-07-02
**Status:** Approved (pending written-spec review)
**Builds on:** Plan 5 (kitchen tickets already created offline). Part of the offline-first POS effort.

---

## 1. Background & goal

The stores are fully digital: cashier tablet, a server/refill device, and a kitchen tablet showing a KDS screen fed by Firestore. There is **no printing** for kitchen tickets today. When the internet drops, Firestore can't relay the cashier/server device's offline tickets to the kitchen tablet (no LAN/peer sync), so **the kitchen goes blind during an outage**.

**Goal:** During an internet outage, the cashier app and the server/refill page **auto-print kitchen tickets to a shared Bluetooth thermal printer** near the kitchen, but only for kitchen locations the store designates. Online behavior is unchanged (the KDS screen). No new native code — reuse the existing Bluetooth plugin.

### Confirmed decisions (from brainstorming)
| Decision | Choice |
|---|---|
| Transport | **Bluetooth** (reuse existing `ThermalPrinterPlugin`; no TCP/native work) |
| When to print | **Offline only** (during an outage); online uses the KDS screen as today |
| Printer topology | **One shared BT printer** per store; 2 devices (cashier + server) take turns (connect → print → disconnect) |
| What prints | Only kitchen locations flagged `printOnOutage` |
| Trigger | **Automatic** on offline ticket creation (no manual step) |
| Print failure | **Retry, then alert the cashier** ("deliver this order manually") |
| Reconnect backlog | **Auto-acknowledge** — offline-printed tickets are marked served on sync so they skip the KDS active queue |

### Non-goals
- No network/TCP printing (Bluetooth chosen).
- No customer LAN self-ordering.
- No change to the online KDS flow.
- `voidSession` / line-adjustments offline remain deferred (separate plan).

## 2. Transport & printer sharing

- Reuse `src/lib/printing/thermalPrinter.ts` (`ThermalPrinterPlugin`, Bluetooth) and `printHub`'s existing **connect → print → disconnect** pattern (it already releases the BT socket after each print, so two devices can share one printer sequentially).
- Each of the 2 devices **pairs once** with the shared kitchen BT printer and stores that printer's address locally under a **new, separate** key `kitchen_printer_address` — distinct from the existing receipt printer (`last_printer_address`), since the kitchen printer is a different physical device.
- Concurrency: because both devices print to one BT printer, a print may find it **busy** (the other device is mid-print). This is handled by retry (see §6).

## 3. When it prints (gating)

A kitchen ticket prints **only if all** are true:
1. The device is **offline** (the ticket was created via a Plan 5 **offline branch**, so this is implicit at the call site).
2. The ticket's kitchen location has **`printOnOutage = true`**.
3. This device has a **kitchen printer paired** (`kitchen_printer_address` set).

If any is false → no print (and for #3, a one-time "set up your kitchen printer" nudge).

## 4. Components (small, focused)

1. **`formatKitchenTicket(ticket, opts)`** — new, **pure** (`src/lib/printing/kitchenTicketFormatter.ts`). Builds ESC/POS plain text for a kitchen ticket: an **"*** OFFLINE ***"** header, station (kitchen location) name, TABLE/CUSTOMER, item name × qty with modifiers and notes, and the ticket time. Separate from `receiptFormatter.ts` (receipts are money; kitchen tickets are prep instructions).

2. **`printKitchenTicketBackup(ticket, deps)`** — new (`src/lib/printing/kitchenBackupPrint.ts`). Orchestrates one ticket: checks the gates (§3), formats via `formatKitchenTicket`, prints via the BT plugin with **retry** (§6), then stamps the ticket `printedOffline` (§5). Dependencies (printer address getter, the location-flag lookup, the print function, a cashier-alert callback) are injected so the gating/retry logic is unit-testable without a real printer.

3. **`createKitchenTickets` returns the created ticket payload(s)** — small change in `firestore.ts`: it currently returns `void`. Have it return the ticket payload(s) it built so the **offline branches** can hand them to `printKitchenTicketBackup`. Online callers ignore the return (no behavior change).

4. **Print trigger at the offline creation sites** — after `commitLocalFirst(batch, …)` in each offline ticket-creating branch (start-session package ticket, `AddonsPOSModal`, `RefillPOSModal` ×2, `session-detail-view`), call `printKitchenTicketBackup(payload)` for each created ticket. (Fire-and-forget; printing must never block the order flow.)

5. **Per-location config** — add `printOnOutage?: boolean` to the `KitchenLocation` type (`stores/{storeId}/kitchenLocations/{id}`), with a toggle in the admin stores page. Synced via Firestore (cached, available offline).

6. **Device pairing UI** — a "Kitchen printer" picker (reuse the existing Bluetooth printer-selection UI used for the receipt printer) that stores `kitchen_printer_address` per device.

7. **KDS auto-acknowledge** — the kitchen (KDS) page treats tickets stamped `printedOffline: true` as **already served on sync**: it marks them served (using `printedOfflineAt` as the serve time via the existing "mark served" path, so served counts/durations stay consistent) and keeps them out of the active prep/alerting queue.

## 5. Ticket stamp

On a **successful** backup print, stamp the ticket doc (local-first write, not awaited): `printedOffline: true`, `printedOfflineAt: <clientMs>`, `printedOfflineDevice: <deviceId>` (from Plan 1's device id, for audit). This drives the KDS auto-acknowledge on reconnect.

## 6. Error handling

- **Printer busy** (the other device is printing) → retry a small number of times with a short delay before giving up.
- **Printer off / out of BT range** → after retries fail, invoke the **cashier alert** ("Kitchen printer unreachable — deliver this order manually"). The ticket is still recorded locally and syncs later; only the paper handoff failed.
- **No kitchen printer paired on this device** → skip printing; show a one-time setup nudge. (The order/ticket still succeeds; this device just can't print.)
- Printing is always **fire-and-forget** relative to order taking — a print failure never blocks creating the session/line/ticket.

## 7. Data flow

1. Cashier or server creates a kitchen ticket **offline** (Plan 5 branch) → written to the local Firestore cache; `createKitchenTickets` returns the payload.
2. The offline branch calls `printKitchenTicketBackup(payload)` → gates pass → `formatKitchenTicket` → BT connect/print/disconnect (retry on busy/unreachable) → on success, stamp `printedOffline`.
3. On reconnect → the ticket (and its `printedOffline` stamp) syncs to Firestore → the KDS **auto-acknowledges** it (marks served, skips the active queue).

## 8. Testing

- **Unit (node):** `formatKitchenTicket` (pure — station/items/qty/modifiers/notes/offline header, width handling); the gate + retry logic of `printKitchenTicketBackup` with injected deps and a fake printer (prints when flagged+paired; skips when not; retries on busy; alerts after N failures; stamps on success).
- **On-device (APK):** pair one BT printer to both devices; go offline; create tickets from cashier **and** server → both print (taking turns); toggle a location's `printOnOutage` off → it doesn't print; power the printer off → cashier gets the alert and the order still records; reconnect → the KDS auto-acknowledges the offline-printed tickets (no active-queue flood, no double-prep).

## 9. Affected code (initial map)

- New: `src/lib/printing/kitchenTicketFormatter.ts`, `src/lib/printing/kitchenBackupPrint.ts` (+ their tests).
- `src/components/cashier/firestore.ts` — `createKitchenTickets` returns its payload(s); `KitchenLocation` config read.
- `src/lib/types.ts` — `KitchenLocation.printOnOutage?`.
- Offline branches (Plan 5): `AddonsPOSModal.tsx`, `RefillPOSModal.tsx`, `session-detail-view.tsx`, and the start-session package-ticket path — call `printKitchenTicketBackup`.
- Admin stores page — `printOnOutage` toggle per kitchen location.
- Printer settings UI — kitchen-printer pairing (`kitchen_printer_address`).
- KDS/kitchen page — auto-acknowledge `printedOffline` tickets.
- Reuse: `thermalPrinter.ts`/`printHub` (BT), `use-online-status` (Plan 4), device id (Plan 1).

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Two devices contend for one BT printer | connect/print/disconnect per print + retry-on-busy; outage volume is low |
| BT range: printer not reachable from a device | Retry then cashier alert; document that the printer must be within BT range of both devices |
| Kitchen printer not paired on a device | Skip + one-time setup nudge; order still records |
| Auto-ack marking served skews KDS analytics | Reuse the existing "mark served" path with `printedOfflineAt`, so counts/durations are recorded consistently |
| Print blocks the order flow | Printing is fire-and-forget; never awaited in the order path |

## 11. Sequencing (value early)

1. `formatKitchenTicket` (pure) + `printKitchenTicketBackup` (gating/retry, injected deps) — unit-tested.
2. `createKitchenTickets` returns payload(s); `KitchenLocation.printOnOutage` + admin toggle; kitchen-printer pairing UI.
3. Wire `printKitchenTicketBackup` into the offline creation branches.
4. KDS auto-acknowledge of `printedOffline` tickets.
5. On-device test pass.
