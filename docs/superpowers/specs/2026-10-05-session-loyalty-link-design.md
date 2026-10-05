# Session ↔ Sharelebrator link: cashier visibility + manual link

Date: 2026-10-05 · Repo: POS (port 9003) · Status: design approved in chat, spec pending review

## Goal
A session that is linked to a Sharelebrator (loyalty) card must be visibly so for the cashier at every stage
(session cards, bill screen), and a cashier can attach a card to an **unlinked** session before billout
(QR scan or customer search), so a customer who never linked on their own phone still earns points.

## Findings that shape the design (static read, 2026-10-05)
- The link is `linkedCustomerPhone` / `linkedCustomerName` / `linkedByParticipantId` on
  `stores/{sid}/activeSessions/{id}` and `.../sessions/{id}`. **PIN expiry (2h) never touches it**; points are earned
  at billout from `activeSessions.linkedCustomerPhone` (`payment-modal.tsx:410`, `api/loyalty/earn`, `lib/server/loyalty.ts`).
  So item "link must persist" already holds in data; the visible gap is the cashier UI.
- Cashier cards (`active-sessions-grid.tsx`) show no customer and no card. Bill screen (`payment-modal.tsx`) reads
  the link only at submit and shows nothing. Detail view already shows it (`session-header.tsx:35`, `LoyaltyRedeemCard`).
- Card QR payload is the phone string `+63XXXXXXXXXX` (= `customers/{phone}` doc ID). `normalizePhone` in `src/lib/phone.ts`.
- `customers` is deliberately store-scoped for non-admin staff (`api/loyalty/store-customers`, `lookup` presence check).
  A global name search would leak other branches' customers, so name search is scoped (see Search).
- Reusable: `src/components/qr-wallet/QrScanner.tsx` (`onResult(payload)`, jsqr).

## Rules
1. **Add-only.** Cashier link allowed only when the session is open, has no `linkedCustomerPhone`, and
   `linkedCustomerLockedAt` is unset. No replace/unlink in this scope.
2. Link requires connectivity. Offline: banner says so; billout unchanged.
3. Customer-side link (existing route) is untouched.

## Data
No new collections or required fields. Cashier link writes on both `activeSessions` and `sessions`:
`linkedCustomerPhone`, `linkedCustomerName`, `linkedByParticipantId: null`, plus audit fields
`linkedBy: "cashier"`, `linkedByUid`, `linkedAt`. Add these to the session type (`src/lib/types.ts` ~1104).
`CUSTOMER/.../me/route.ts` requires `linkedByParticipantId === participantId`; null means the diner app shows
"linked to another diner" — acceptable, out of scope (CUSTOMER repo).

## API
**`POST /api/loyalty/link-session`** (new) — Bearer ID token; `requireActiveStaff` roles admin/manager/cashier;
store must be in `assignedStoreIds` (unless platform admin).
Body `{storeId, sessionId, phone}`. Steps: `normalizePhone`; read session + `customers/{phone}`;
409 if already linked/locked/closed; 404 if customer missing; one Admin batch writes both docs; returns
`{ok, phone, name, pointsBalance}`. Idempotent for the same phone.

**`GET /api/loyalty/find-customer?storeId=&q=`** (new) — same staff auth.
- `q` normalizes to a valid PH phone → exact `customers/{phone}` get (any branch; exact number is a possession proof).
- otherwise name search: query `customers` where `storeVisits.{storeId}.lastVisitAtMs > 0`, ordered by it desc
  (most recent visitors first), limit 500, case-insensitive substring on name in memory, return max 10
  `{phone, name, pointsBalance}`. Min 2 chars.
  Customers who never visited this store are found by exact phone or QR only.
Returned phone is shown masked in lists (`+63 9•• ••• 1234`); full phone only in the confirm step.

## UI
- **Pill spec:** card owner = black pill (`bg-black text-white`), `★` first, then name: `★ Maria Santos`.
  Unlinked = grey pill "No card". Small "via cashier" suffix when `linkedBy === "cashier"`. Guest pill = session `customerName`.
- **Session cards** (`active-sessions-grid.tsx`): guest pill + card pill, from the existing `activeSessions` snapshot (no extra reads).
- **Bill screen** (`payment-modal.tsx`): top banner. Linked → black pill + "Earning points" + estimated points
  (`floor(grandTotal × loyaltyConfig.pointsPerPeso)`). Unlinked → amber "No loyalty card linked" + **Link card** button.
  Banner reads the live `activeSessions` doc so it updates right after linking.
- **Link dialog** (new `src/components/cashier/LinkCardDialog.tsx`): tabs Scan QR (reuses `QrScanner`, payload →
  `normalizePhone`) / Search (phone or name). Result list → confirm step (name, points balance) → call link route.
  Entry points: session header, bill screen banner, card pill (when unlinked, cashier/manager only).
- Match existing badge/button styling; no new design tokens.

## Errors
409 already linked/locked → toast "Session already linked to {name}"; 404 → "No Sharelebrator account for that number";
403 → role/store message; scanner denied/unreadable QR → fall back to Search tab.

## Testing
- Route unit tests (vitest, mocked admin): unlinked ok, already-linked 409, locked 409, closed 409, unknown phone 404,
  wrong-store 403, same-phone idempotent.
- `find-customer`: phone exact, name substring scoped to store, <2 chars rejected, cap 10.
- QR payload parse: `+639171234567`, `09171234567`, junk.
- Browser verification on :9003: cards show pills; bill screen banner both states; link via search; points earned
  on billout for a cashier-linked session (ledger doc id = receiptId).

## Out of scope
Replace/unlink; offline linking; customer-app (CUSTOMER) re-view of card after PIN expiry or the
"linked to another diner" message after rejoin; any change to PIN TTL.
