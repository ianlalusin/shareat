# Smoke test: cashier vs diner card linking (TEST store only)

Covers the transaction/route behavior the unit tests only check against fakes.
Run only on the `TEST` store. Do not run on a live store.

## Setup
- POS: `npm run dev` in `POS` (port 9003), store selector = TEST.
- Customer app: must run the branch `origin/claude/keen-bardeen-8f0h7i` (has the cashier-link protections).
  Currently served from the worktree `CUSTOMER/.claude/worktrees/smoke` on port 9004 (`customer-smoke` launch config).
  The main `CUSTOMER` checkout (branch `main`) does NOT have these fixes.
- Both servers stop with the Browser pane's server controls; stop them when done (one dev server per reserved port).

## Test cards
| Card | Who | How to get it |
|---|---|---|
| **A** | existing `ShareEat` account (+63 950 036 9267) | already exists |
| **B** | new account "Smoke B" (any unused PH number, e.g. 09xx…, password of your choice) | sign up in the customer app (Test 0). Signing up needs an in-store PIN session. You enter the password yourself. |

## Test 0 — create card B (diner side, unlinked session)
1. POS (TEST): New Session → Unlimited → a free table + package + guests → create. Issue/print its PIN (`/pins` page or the session screen).
2. Customer app (`localhost:9004`): Enter Session with that PIN → Sharelebrator Card → create account "Smoke B" → it links to that session.
3. Expect: POS shows `★ Smoke B` pill on that session (no "via cashier").
4. Void that session in POS (reason "smoke test").

## Test 1 — cashier links card A
1. POS: new Unlimited session S2 on TEST, issue its PIN.
2. S2 header "No card" → search `share` → ShareEat → Link.
3. Expect: pill `★ ShareEat via cashier`; the redeem box is replaced by "points earn only".

## Test 2 — diner tries a DIFFERENT card (card B) → 409
1. Customer app: join S2 with its PIN → Sharelebrator Card → sign in as card B and link to this table.
2. Expect: HTTP 409 on `link-session` (Network tab) / "already linked" message. POS pill is still `★ ShareEat via cashier`.

## Test 3 — diner tries to unlink the cashier link → 403
1. Same diner session. If the UI has an Unlink action, use it; otherwise POST `/api/customer/sharelebrator/unlink-session` with the diner's session token from devtools.
2. Expect: 403. POS pill unchanged.

## Test 4 — same card as a diner (card A) → upgrade
1. Customer app, same session: sign in as card A (ShareEat) and link to this table.
2. Expect: success. POS pill becomes `★ ShareEat` (no "via cashier"), the redeem box is available again, `linkedBy` is cleared on the session.

## Test 5 — bill out
1. Add a charge/item of ₱100+ on S2, pay cash.
2. Expect: ShareEat points increase (₱100 at rate 0.01 = +1 pt). Card page in customer app shows the new total.

## Record
Date, who ran it, pass/fail per test, and any status code that differed.

### Run 2026-10-05 (TEST store; customer app on branch `claude/keen-bardeen-8f0h7i` @ `34ff676`)
| Test | Result |
|---|---|
| 1. Cashier links card A (ShareEat) | Pass — `★ SharEat via cashier` on the table card |
| 2. Diner links a different card (B, Ian Lalusin) | Pass — refused, notice "This table is already using ShareEat's card"; POS pill unchanged. HTTP status not captured. |
| 3. Diner unlinks the cashier link | Pass in the UI — card B gets a view-only screen with no Unlink button. A forced `unlink-session` call (expect 403) was NOT exercised. |
| 4. Same card as a diner (A) upgrades the link | Pass — pill lost "via cashier", redeem box returned on the bill screen |
| 5. Bill-out earns points | Pass — ShareEat points increased after paying the ₱596 bill |

Follow-ups found: diner notice for a cashier link told the diner to "ask them to unlink it"; fixed on the CUSTOMER branch in `34ff676` ("ask the cashier"). Not yet on customer `main`.
