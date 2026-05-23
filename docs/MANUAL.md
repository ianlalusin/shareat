# SharEat Hub - Instruction Manual

## 1. Introduction

Welcome to SharEat Hub, your all-in-one solution for managing restaurant operations. This manual provides a guide for all staff roles to effectively use the system, from initial setup to daily tasks.

---

## 2. Getting Started: Onboarding

Every new staff member must create an account to access the system.

1.  **Sign Up**: Navigate to the login page and click the "Sign up" link. Create an account using your email and a secure password.
2.  **Provide Details**: After creating your account, you will be prompted to enter your full name, address, and contact number.
3.  **Await Approval**: Once your details are submitted, your account status will be "Pending". A Platform Admin or Manager must approve your account and assign you a role and store(s) before you can log in.
4.  **First Login**: After your account is approved, you can log in with your credentials. You will be directed to the main dashboard for your role.

---

## 3. Role: Platform Administrator

Platform Admins have the highest level of access and are responsible for the global configuration of the system.

### Key Responsibilities:

-   **Staff Management**:
    -   Navigate to **Admin > Staff Management**.
    -   Approve pending user accounts, assign them a role (Manager, Cashier, etc.), and assign them to one or more stores.
    -   Deactivate or delete staff accounts as needed.
-   **Store Management**:
    -   Navigate to **Admin > Store Management**.
    -   Create new restaurant locations, edit their details (address, tax info, hours), and activate/deactivate them.
    -   Per-store toggles: **Accepts Online Reservations** (lists the branch on the public website's booking form), **Offers Unlimited (Dine-in)** and **Offers Ala Carte** (which session modes the cashier can start — e.g. a take-out kiosk turns Unlimited off).
-   **Global Menu Management**:
    -   Navigate to **Admin > Menu Hub**.
    -   **Products**: The master catalog. A product can be a **single** item or part of a **Family** — a parent (e.g. "Sharebowl") with **variants** (Beef / Chicken / …), each its own sellable SKU with its own barcode.
        -   **Merge**: select two or more products and merge them into a family.
        -   **Archive**: soft-delete a product/family. Archived items drop into a pinned "Archived" group at the bottom (regardless of sort) and are auto-deactivated; restore from there.
        -   **Family picture**: the family shows the first variant that has an image; variants without their own image inherit it on the cashier screens.
        -   **Sub-category groups** are collapsible.
        -   **Sync Inventory**: one click pushes family/variant info (kind, group, names) from the catalog into **every** store's inventory.
    -   **Option Groups (modifiers)**: reusable choices (e.g. Size, Add Cheese) attached to products and applied at order time, with price deltas, single/multi select, and required / min / max rules.
    -   **Flavors**: Manage global flavors.
    -   **Refills**: Define refillable items.
    -   **Packages**: Create global package templates.
-   **Universal Collections**: platform-wide discounts and charges, plus oversight of store-scoped entries.
-   **Customer App Catalog**: manage the customer-app menu and link each item to a POS product.
-   **Analysis** (also available to Managers):
    -   **Data Analysis**: 360° historical performance, comparisons, trends.
    -   **Customer Requests**: every floor request for the store with response times (see §9).
-   **Data Tools**: Reconciliation (analytics vs receipts) and Analytics Backfill.

---

## 4. Role: Manager

Managers oversee the operations of their assigned store(s).

### Key Responsibilities:

-   **Store Settings**:
    -   Navigate to **Admin > Store Settings**.
    -   **Packages**: Set the price and availability for global packages within your store.
    -   **Refills & Flavors**: Enable or disable specific refills and flavors for your store.
    -   **Kitchen**: Define kitchen stations (e.g., "Fryer", "Grill"), each with a **serve-time SLA (minutes)** that drives the KDS late-ticket alerts.
    -   **Tables**: Configure the tables available in your restaurant.
-   **Collections**:
    -   Navigate to **Admin > Collections**.
    -   Manage store-specific **Modes of Payment**, **Charges** (e.g., Service Charge), and **Discounts** (e.g., Senior Citizen).
-   **Inventory Management**:
    -   Navigate to **Admin > Inventory Management**.
    -   Add products from the global catalog to your store's inventory; set `Cost` and `Selling Price`; mark items as "Add-ons" to sell individually; **archive** items you no longer stock.
    -   **Backfill Data**: copies missing image URLs and barcodes from the global product onto inventory items. (Family/variant grouping is propagated separately by the admin **Sync Inventory** action — see §3.)
-   **Reservations**: review and manage bookings for your store (see §8).
-   **Cash Handover**: record shift-change till handovers (see §5).
-   **Reporting & Logs**:
    -   **Dashboard**: real-time sales analytics, top-selling items, payment mix, and performance metrics.
    -   **Receipts & History**: browse past transactions, reprint, and correct.
    -   **Activity Logs**: audit trail of staff actions, including a **Staff Adjustments** breakdown of voids / comps / discounts per cashier with outlier flags (manager / admin only).
    -   **Customer Requests** (Analysis): all floor requests with response times (§9).

---

## 5. Role: Cashier

Cashiers are responsible for managing customer sessions and processing payments.

### Key Responsibilities:

-   **Starting a Session**:
    -   From the **Cashier** page, select "Unlimited" or "Ala Carte" (only the modes the store offers are shown).
    -   **For Unlimited**: Select an available table, choose the package, set the guest count, and select initial flavors.
    -   **For Ala Carte**: Enter the customer's name.
    -   Click "Start Session". For unlimited packages, the session becomes "Pending Verification" for a server. Ala carte orders are immediately active.
    -   You can also seat a **walk-in from the Waitlist** or a **reservation** ("Seat now" on the Reservations page prefills a new session — see §8).
-   **Managing an Active Bill**:
    -   Click on an active session from the grid.
    -   **Add Add-ons**: Use the "Add Add-on" button. Single items add directly; a **family tile** opens a combined picker where you lock the variant, choose any **modifiers** (price deltas apply), set quantity, and add — all in one place.
    -   **Apply Adjustments**: bill-wide discounts/charges, or per-line discount / mark-free / void. Sessions with adjustments show Void / Disc / Free badges on the session grid.
    -   **Take Payment**: record one or more payments across methods; balance and change calculate automatically.
-   **Completing Payment**:
    -   Once the balance is zero (or more has been paid), click "Complete Payment". This closes the session, generates a receipt, and redirects to the receipt page for printing.
-   **Cash Handover** (shift change): from the cashier header open **Cash Handover**. Record the starting float (carried from the prior handover), the auto-computed cash sales for the window, any cash-out **deductions** (with reasons), the **counted** cash, the resulting **variance**, and both the outgoing and incoming cashier names. History and XLSX export are on the same page.

---

## 6. Role: Server

Servers are responsible for on-the-floor guest management and order-taking for refills and add-ons.

### Key Responsibilities:

-   **Verifying New Sessions**:
    -   On the **Server** page, find sessions in the "Pending Verification" list.
    -   Physically count the guests at the table.
    -   Enter the correct guest count in the "Server" field and click "Verify".
    -   If the count differs from the cashier's, a manager's approval may be needed.
-   **Managing Active Sessions**:
    -   **Order Refills**: Click the "Refill" button on an active session card. Select the refill items and flavors requested by the guests.
    -   **Order Add-ons**: Click the "Add-on" button to open the POS for add-on items (same family/variant + modifier picker as the cashier).
    -   All orders are sent directly to the designated kitchen station.
-   **Requesting Changes**:
    -   If a guest count or package changes mid-session, click "Request Change" on the session card and submit the request for cashier/manager approval.
-   **Sign-in**: servers identify themselves with a device-local profile so actions are attributed by name. **Platform admins skip this** — they go straight to the station and their actions attribute to their account.

---

## 7. Role: Kitchen Staff

Kitchen staff use the Kitchen Display System (KDS) to manage incoming orders.

### Key Responsibilities:

-   **Monitoring Orders**:
    -   On the **Kitchen** page, new orders appear as tickets in the appropriate station tab (e.g., "Fryer", "Drinks").
    -   Each ticket shows the item, quantity, modifiers, notes/flavors, and how long it has been waiting.
    -   **Late alerts**: once a ticket passes its station's serve-time **SLA** (set in Store Settings), the card turns red with a pulsing "Late" badge and the station tab shows an "N late" counter.
-   **Managing Tickets**:
    -   When an item is ready, click **"Served"** (or batch-serve part of a multi-qty ticket). It leaves the active screen.
    -   If an item cannot be made, click **"Cancel"** and select a reason. This notifies the cashier/server.
-   **Customer Requests**:
    -   A floating button opens the **Customer Requests** panel — free-text requests guests send from the customer app. Mark each **Done** when handled.
    -   The **Done** tab shows the **turnaround time** (request → done), color-coded. Only today's requests live here; the full history is in **Admin > Analysis > Customer Requests** (§9).
-   **Viewing History**:
    -   The "Order History" panel shows recently completed or cancelled items for quick reference.

---

## 8. Feature: Reservations

Forward table bookings, managed on the dedicated **Reservations** page (admin / manager / cashier).

-   **Per day**: pick a date and see that day's bookings; filter to open (booked/confirmed) or show all. The nav link carries a badge with today's open count.
-   **Create / edit**: customer name, date & time, party size, phone, notes.
-   **Lifecycle**: bookings start as **Pending** (status "booked"). Staff **Confirm** after contacting the customer, **Cancel**, or mark **No-show**.
-   **Seat now**: hands the party to the cashier — it prefills a new session and, on completion, marks the reservation seated and links it to the session.
-   **Website bookings**: the public SharEat website can submit reservations into the same list (tagged `web`). These also arrive Pending for staff confirmation. The website booking form is gated behind a launch flag and its cloud backend (Cloud Functions + App Check) until enabled.

---

## 9. Feature: Customer Requests

Free-text requests guests send from the customer app.

-   **Kitchen (live)**: the KDS Customer Requests panel lists today's pending requests; mark each **Done**. The Done tab shows **turnaround time** (request → done).
-   **Admin (history)**: **Admin > Analysis > Customer Requests** shows the full history for the store — date presets (today / 7d / 30d / all), status and text filters, summary stats (total, pending, completed, **average response time**), per-row response time, and XLSX export.

---

## Session Activity Log

A running log of feature changes and meaningful fixes shipped per session. Newest entries on top.

### 2026-05-24 — Product families, reservations, cash handover, KDS SLA, and more

**Shipped to:** `sev5_advanced` (POS) and `main` (SharEat website). One multi-day batch; the role sections above (§3–§9) were rewritten to match.

**Products & menu**
- **Families / variants**: products can be grouped into a family parent with sellable variants. Added a **Merge** UI, **archive** (soft-delete → pinned "Archived" group, auto-deactivate, restore), collapsible sub-category groups, and **Sync Inventory** to push family metadata into every store's inventory.
- **Option Groups (modifiers)**: reusable, price-delta modifiers attached to products and applied at order time (single/multi, required, min/max). New combined **Family Order Modal** in the cashier/server addon picker (variant → modifiers → qty → add) with a "Clear" affordance for optional radio groups.
- **Family picture**: family tile and imageless variants resolve to the first variant that has an image. (AI image generation for products is designed but deferred until image-model access is confirmed.)

**Stores**
- New per-store toggles: `acceptsReservations`, `offersAlaCarte`, `offersUnlimited`.

**Reservations** (new)
- Dedicated `/reservations` page (create/edit/confirm/cancel/no-show, day view, nav badge). "Seat now" hands off to the cashier and links the created session. Public website booking pipeline (Admin SDK Cloud Functions writing into the POS Firestore, App Check, hidden `/admin` mapping page) built and gated behind a launch flag pending cloud setup.

**Cash Handover** (new)
- `/cashier/handover` till log: starting float, auto-computed cash sales, deductions, counted cash, variance, both cashier names; history + XLSX.

**Oversight & analysis**
- `/logs` **Staff Adjustments** card: per-cashier voids/comps/discounts with outlier flags (manager/admin only).
- `/admin/customer-requests` (Analysis): full customer-request history with response-time stats and export.

**Kitchen**
- Per-station **serve-time SLA**; KDS flags late tickets (red + "Late" badge + per-tab "N late" counter). Customer-request **turnaround** time on the Done tab.

**Server**
- Platform admins **skip the local server-profile sign-in**; the Verify-Average card shows for them too.

**Read-cost optimizations** (no behavior change)
- Dropped the per-session bill-line listener fan-out (badge flags now maintained on the `activeSessions` projection); lazy `storeAddons` subscription; consolidated kitchen `rtKdsTickets` listeners and one-shot flavors fetch; lazy-mounted settings/collections tab panels.

### 2026-04-27 — Fix: Bluetooth printer fails after GrabFood (or any other app) uses the same printer

**Shipped to:** `sev5_advanced` only (Android-native code; `sev6` uses the same plugin but the fix applies there too — manual cherry-pick needed after APK build verification).

**Root cause:** The POS held its Bluetooth RFCOMM socket open indefinitely after printing. `printViaNativeBluetooth()` in `printHub.ts` called `connectBluetoothPrinter` but never called `disconnectBluetoothPrinter`, so the socket lived for the entire app session. When another app (e.g. GrabFood) needed the same printer, it either failed to connect (POS was holding the link) or forced the OS to drop the POS socket, leaving the POS's cached `outputStream` pointing at a dead connection. The next POS receipt print then failed because the stale socket rejected writes. Two secondary weaknesses made recovery impossible: (1) `disconnect()` had stream + socket in a single `try` block — if `outputStream.close()` threw, `bluetoothSocket.close()` was never reached, leaving the socket leaked; (2) `handleOnResume()` tried a zero-byte write to detect socket health, but Android's BT stack doesn't actually flush zero-byte writes to the wire, so the check always passed even on a dead socket, and the "reconnect" path kept the same stale socket alive.

**Fix:**
- `printViaNativeBluetooth()` (`src/lib/printing/printHub.ts`): wrapped the logo + receipt print body in a `try/finally` that always calls `ThermalPrinter.disconnectBluetoothPrinter()` — same pattern used by the PIN slip flow. Each receipt job is now self-contained: connect → print → disconnect.
- `disconnect()` (`ThermalPrinterPlugin.java`): split into two independent `try` blocks (one for `outputStream.close()`, one for `bluetoothSocket.close()`), each setting its field to `null`. A stream-close failure no longer prevents the socket from closing.
- `handleOnResume()` (`ThermalPrinterPlugin.java`): replaced the unreliable zero-byte health check + reconnect with a simple `disconnect()` call. When the app comes back to foreground any held socket is dropped; the next print job connects fresh. This also prevents the POS from blocking other apps that used the printer while the POS was paused.

**Net effect:** GrabFood can print while the POS is foregrounded or in the background; the POS will always reconnect cleanly on its next print job.

**Files touched**
- Modified: `src/lib/printing/printHub.ts`, `android/app/src/main/java/net/shareat/pos/ThermalPrinterPlugin.java`.

---

### 2026-04-27 — Fix: Today's Forecast actual-vs-projected and missing accuracy days

**Shipped to:** `sev5_advanced` only. Not applied to `sev6` — the bugs don't exist there: sev6's `TodayForecastCard` doesn't show an actual-vs-projected comparison, and sev6 still generates forecasts client-side via `localStorage`-gated `useForecastAnalytics`, not via server cron.

**Bug 1 — "Actual" on Today's Forecast card showed the date-preset's total, not today's.**
- `DashboardPageClient.tsx` was passing `actualSalesToday={stats?.netSales}`. `stats` comes from `useDashboardAnalytics` which is filtered by the dashboard's date preset, so picking "Last 7 Days" caused the forecast comparison to use the 7-day total as today's actual.
- Fix: `useForecastAnalytics` now subscribes directly to `stores/{storeId}/analytics/{todayDayId}` and returns `actualSalesToday`. The dashboard passes this value instead of `stats.netSales`. Forecast comparison is now decoupled from the date filter.

**Bug 2 — Forecast accuracy not updating daily; some days permanently missing.**
- `generate-forecast.ts` had `updateYesterdayAccuracy` — a single-day update. The cron path (`/api/cron/generate-forecast` → `runForecastWithTracking` → `generateForecastForStore`) called it once per Manila day, gated by `system/forecastCronLog`. Any cron run that skipped, errored, or fired before yesterday's analytics doc was complete left a permanent gap, because the next day's run only updated *its* yesterday.
- Fix: replaced with `backfillRecentAccuracy(storeId, now, days=7)` — idempotent loop that fills `accuracy`/`actualSales` for any forecast doc within the last 7 days that's missing them. Now wired into both the daily-cron path (`generateForecastForStore`) and the standalone accuracy cron (`updateAccuracyForAllActiveStores`). Missed days self-heal on the next successful run.
- The pre-existing manual `/api/admin/backfill-forecast-accuracy` endpoint still works the same.

**Files touched**
- Modified: `src/hooks/useForecastAnalytics.ts`, `src/components/dashboard/DashboardPageClient.tsx`, `src/lib/server/generate-forecast.ts`.

---

### 2026-04-25 — Fix: Add-ons modal action bar hidden on Android phone

**Shipped to:** `sev5_advanced` and `sev6` (see commit hashes after push).

**Symptom:** On Android phones, when a server opened the Add-ons modal on `/server` and tapped the search input, the qty stepper and "Add to Order" button vanished below the visible screen.

**Root cause:** `AddonsPOSModal`'s mobile (Vaul `Drawer`) layout had a hard-coded `ScrollArea h-[55vh]` inside a non-flex wrapper, with no `dvh`-based cap on `DrawerContent`. When the soft keyboard opened, the visual viewport shrank but nothing in the layout shrank with it — the browser scrolled the focused input into view, pushing the drawer's bottom (the action bar) behind the keyboard.

**Fix (mobile-only):** In `src/components/shared/AddonsPOSModal.tsx`:
- `DrawerContent` capped at `max-h-[92dvh]` so the sheet always fits inside the dynamic viewport (Android WebView shrinks dvh when the keyboard opens).
- Drawer inner wrapper turned into a flex column (`flex-1 min-h-0 flex flex-col`).
- `DrawerHeader` marked `shrink-0`.
- `POSContent` accepts an `isMobile` prop. When mobile: root becomes `flex flex-col flex-1 min-h-0`; ScrollArea swaps `h-[55vh]` for `flex-1 min-h-0`; search row and bottom action bar marked `shrink-0`.
- Desktop `Dialog` path untouched.

**Net effect:** ScrollArea absorbs the keyboard's viewport reduction; the action bar (qty stepper + "Add to Order") stays pinned and visible above the keyboard.

---

### 2026-04-25 — Dashboard Payment Mix conversions + discount card clarification

**Shipped to:** `sev5_advanced` (commit `34e094a`), cherry-picked to `sev6` (commit `f8a5278`).

**Payment Mix → Convert (new feature)**
- Added a **Convert** button on the Dashboard's Payment Mix card (visible to admin / manager / platform admin).
- Clicking opens a modal where the user records a payment-mode conversion: `From method`, `To method`, `Amount`, optional `Note`. Methods are seeded from the current payment mix; "Other…" allows a custom method name.
- A conversion is a **non-sales transaction** that reshuffles balances between methods (e.g., a GCash cashout to a customer: `−₱X cash, +₱X gcash`). Receipts are never altered.
- Implementation:
    - Source-of-truth doc: `stores/{storeId}/paymentConversions/{id}` with `amount`, `fromMethod`, `toMethod`, `dayId`, `dayStartMs`, `note`, `status`, `createdBy`, `createdAt`, `voidedAt`/`voidedBy`.
    - Projection updates write `payments.byMethod.{from} -= amount` and `payments.byMethod.{to} += amount` on `analytics/{dayId}`, monthly/yearly rollups, and every applicable `dashPresets/*` doc — same pattern as `applyAnalyticsDeltaV2`.
    - `payments.totalGross` and `payments.txCount` are deliberately untouched, so net-sales reconciliation still balances and the Payment Mix mismatch warning does not false-positive.
    - Single Firestore transaction per create / void; voiding reverses the deltas and is idempotent.
- Today's conversions list inside the modal lets the user **void** a mistaken entry with a single click (with a confirm prompt). Voided rows are dimmed and tagged.
- ERP impact: `/api/external/sales` and `/api/external/payment-methods` already read from `payments.byMethod`, so they immediately return the post-conversion (real) balance per method — no endpoint change needed.

**Dashboard discount cards — relabeled for clarity**
- Two cards on the dashboard previously appeared to disagree on discount totals. They actually measure two different things from two different projection fields:
    - **Discounts & Charges** reads `payments.discountsTotal` = receipt-level total (line + order-level discounts such as senior/PWD applied to the whole bill, package promos, manual order-level adjustments).
    - **Item Adjustments → Discounted Items** reads `items.discountedAmount` = line-level discounts only, computed from `line.lineAdjustments[kind='discount']`.
- The gap between the two cards = order/subtotal-level discounts. Not a bug, definitional.
- Relabeled so the two read as complementary:
    - `discounts-charges-card.tsx` description → "Receipt-level totals (line + order discounts)."
    - `ItemAdjustmentsCard.tsx` description → "Per-line activity: voided, line-discounted, free, and refunded items."
    - "Discounted Items" row → renamed **"Line Discounts"**.

**Files touched**
- New: `src/lib/analytics/applyPaymentConversion.ts`, `src/components/dashboard/PaymentConvertModal.tsx`
- Modified: `src/components/dashboard/DashboardPageClient.tsx`, `src/components/dashboard/discounts-charges-card.tsx`, `src/components/dashboard/ItemAdjustmentsCard.tsx`, `src/lib/analytics/applyAnalyticsDeltaV2.ts` (exported `getApplicablePresets`).

**Follow-up (same day):** Convert button visibility extended to **cashier** role in addition to admin / manager / platform admin (`DashboardPageClient.tsx:224`).