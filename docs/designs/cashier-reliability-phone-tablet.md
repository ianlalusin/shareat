# Cashier Reliability on Phone and Tablet

*   **Author:** Ian Lalusin
*   **Status:** Draft, revised after review (scope cut to the fix only)
*   **Date:** 2026-11-03

--------------------------------------------------------------------------------

## Overview

The POS runs as an Android app (Capacitor 6) on Lenovo tablets and phones. The app holds its own copy of the web code, so each device runs whatever version was last installed on it.

This version of the POS is due to be replaced by v2 in about two months. This design therefore covers only the fixes cashiers need now. Four pieces of work:

1. Show the app version on screen in the Android app, so we know what each tablet runs.
2. Keep the "Add Item" and "Cancel" buttons visible when the keyboard is open in the variant-item pop-up.
3. Find out why ala carte orders go missing on the kitchen screen, and fix it if payment is the cause.
4. Prove piece 2 with one browser test and a written checklist for the real tablet.

Other cashier screens were not tested and are not changed. See Non-Goals.

## The Problem

**Hidden buttons.**
- When a cashier adds an item that has variants, a pop-up (`FamilyOrderModal`) opens. On a landscape tablet, tapping the "Special instructions" box opens the keyboard, which takes about half the screen.
- The "Add Item" and "Cancel" buttons sit at the end of the pop-up's scrolling area, so they are pushed off screen. They do not come back after the keyboard closes.
- This happens only in the Android app. It does not happen in a browser.
- Candidate causes, not yet confirmed on the tablet. The Android settings file (`AndroidManifest.xml`) has no keyboard setting, so the app window may not shrink when the keyboard opens, and may not grow back after. The pop-up is also capped at `85dvh` with the buttons at the end of one scrolling column.
- Business effect: the cashier cannot add the item. They must close the pop-up and start over.

**Missing ala carte orders on the kitchen screen.**
- Ala carte and dine-in orders use the same kitchen code, and nothing in the code filters ala carte out.
- In a browser, an unpaid ala carte item does show on the kitchen screen.
- Candidate causes, none confirmed: paying clears the kitchen ticket at once, since ala carte pays immediately; an item has no kitchen station, so its ticket is skipped while the item is still billed; the tablet runs an older app version than the browser.
- Business effect: the kitchen may not cook an order the customer has paid for.

## Goals

*   With the keyboard open, "Add Item" and "Cancel" stay visible and tappable in `FamilyOrderModal`, in landscape and portrait, on the Lenovo tablet and on a phone. Closing the keyboard leaves them visible.
*   The Android app shows its version and build number on the login screen and the account page.
*   The cause of missing ala carte kitchen tickets is identified and recorded. If payment is the cause, an ala carte ticket stays on the kitchen screen after payment until the kitchen marks it done.
*   One browser test fails on today's code and passes after the fix, and a written checklist lets staff verify the keyboard behaviour on the real Lenovo tablet.

## Non-Goals

*   Splitting the cashier into a separate app, or a native rewrite.
*   A shared modal component, a viewport hook, or edits to the shared `dialog.tsx` and `drawer.tsx`. These are the fallback if the tablet test of piece 2 still fails.
*   Testing or changing other screens and pop-ups (`ModifierPicker`, `AddonsPOSModal`, the payment pop-up, the waiter page). `AddonsPOSModal` already keeps its "Add to Order" button outside the scroll area, and it benefits from the same Android setting. It is checked once on the device checklist only.
*   Fixing small touch-target, label or layout issues. Known unfixed items: a note typed for one item carries over to the next in `AddonsPOSModal`; double-tapping Add can create two kitchen tickets; the kitchen tab badge counts "ready" tickets the cards do not show; `partially_served` tickets are not cleared at payment.
*   A speed study or trimming Firestore listeners. Cashiers said speed is not a serious problem, and nothing was measured.
*   A cashier warning or a script for items with no kitchen station. Drinks and retail items may have none by design (see the comment at the start of the ticket-creation block in `AddonsPOSModal.tsx`).
*   Changing how the kitchen screen reads data, unless the investigation shows that is the cause.

## Open Questions

Answer the first three before work on the ala carte fix starts.

*   **Ala carte after payment**: does the kitchen card disappear right after payment? Ian pays a test ala carte order in the browser and watches. If it does not, the fix in piece 3 is not made.
*   **Ala carte card lifetime**: if payment is the cause, should a paid ala carte card stay on the kitchen screen until the kitchen taps Served? Piece 3 assumes yes.
*   **Tablet debugging**: does the installed release APK allow Chrome's remote inspect over USB? `.github/workflows/build-apk.yml` builds `assembleRelease` and `capacitor.config.ts` sets no WebView debugging flag, so it may not. If not, skip the readings in Phase A and go straight to the fix.
*   **Lenovo model and Android version**: not given. Record them on the device checklist.
*   **Test sessions**: the browser test starts an ala carte session named `ZZ-TEST-<time>` and never pays. The cashier role cannot void (only admin and manager can), so a manager voids leftover `ZZ-TEST` sessions. Confirm that voided sessions do not appear in real sales reports.

## Critical User Journeys (CUJs)

### CUJ 1: Add a variant item with a note on a landscape tablet
*   **Given**: A cashier is signed in on the Lenovo tablet in the APK, landscape, with an open dine-in session. The item has variants.
*   **When**: They tap the item, pick a variant, tap "Special instructions" so the keyboard opens, and type a note.
*   **Then**: "Cancel" and "Add Item" stay on screen and tappable the whole time. After the keyboard closes they are still visible. Tapping "Add Item" adds the line to the bill.

### CUJ 2: Ala carte order reaches the kitchen (applies only if the pay test confirms payment is the cause)
*   **Given**: A cashier opens an ala carte session. The item has a kitchen station.
*   **When**: They add the item and take payment.
*   **Then**: The kitchen screen shows the ticket and keeps it until the kitchen taps Served. Items with no kitchen station are billed and never reach the kitchen, as today.

### CUJ 3: Check which version a tablet runs
*   **Given**: A tablet with the Android app installed.
*   **When**: A staff member opens the login screen or the account page.
*   **Then**: A label shows the version and build number, for example "v1.0 (build 57)". Two tablets can be compared in seconds.

## Technical Plan (Architecture)

The work is four pieces. Browser tests can show that the pop-up layout keeps its buttons visible in a short window. They cannot show how the Android keyboard behaves. That is proven only on the real tablet with a new APK.

### Piece 1: Version label (Android app only)

- `@capacitor/app` is already installed. Its `App.getInfo()` returns the build number of the installed APK. The build workflow sets that number from the GitHub run number (`-PversionCode=${{ github.run_number }}`). The version name is fixed at "1.0".
- Show "v1.0 (build N)" as small muted text on the login screen and the account page. In a browser there is no APK, so the label renders nothing. The build number identifies an APK; to find its code, look up that run number in GitHub Actions.
- The current APK has no label, so tablets cannot be told apart until the next APK is installed. The practical way to remove the "old APK" doubt is to install the same new APK on both the kitchen and cashier tablets.

### Piece 2: Pinned footer and Android window resize

What the code does today (`family-order-modal.tsx`):
- On a screen under 768px wide it uses a bottom drawer. On wider screens, including a landscape tablet, it uses a centred pop-up capped at `85dvh` with `overflow-y-auto`. The header, variant tiles, modifiers, quantity, note box and the "Cancel" / "Add Item" buttons are one tall column inside that one scrolling shell. The buttons are last in the column.

What changes:
- The pop-up and the drawer become a flex column with three parts: a fixed header, a body that scrolls (`min-h-0 flex-1 overflow-y-auto`), and a fixed footer holding "Cancel" and "Add Item" (`shrink-0`, with a top border). The `85dvh` cap stays, so the pop-up still has a maximum height.
- `android:windowSoftInputMode="adjustResize"` is added to `MainActivity`. With it, the Android window shrinks when the keyboard opens and returns to full height when it closes. The pop-up's `85dvh` then recalculates from the smaller window, so the footer stays above the keyboard.
- The drawer library (vaul) also moves the drawer when the keyboard opens. With `adjustResize` it could move twice, so this modal's `Drawer` sets `repositionInputs={false}`.
- When the "Special instructions" box gets focus, it scrolls into view.
- Both changes ship in one APK, because the pinned footer alone does not help if the window does not resize. If the tablet test still fails, the fallback is the viewport hook and shared modal component listed in Non-Goals.

Phase A, before any code (only if tablet debugging works): with the keyboard open and closed, read `window.innerHeight` and `visualViewport.height` and the pop-up's rectangle. If `innerHeight` does not change when the keyboard opens, the window does not resize ("no resize"). If it shrinks and does not return after closing, that is "no recovery". Both are expected to be fixed by `adjustResize`. Ian decides, and records the numbers in the device checklist.

`adjustResize` applies to the whole app, not only this pop-up. Screens with a text box near the bottom (the cashier list search box, the session note box) are checked once on the device checklist.

```text
   Pop-up / drawer
  +---------------------------+
  | Header (fixed)            |
  +---------------------------+
  | Body (scrolls)            |  max height = 85dvh of the window,
  |  variants, modifiers,     |  and the window shrinks when the
  |  quantity, note           |  keyboard opens (adjustResize)
  +---------------------------+
  | Footer (fixed)            |
  |  Cancel        Add Item   |
  +---------------------------+
```

### Piece 3: Missing ala carte kitchen cards

Investigation first, in this order:
1. Add an ala carte item in the test store and do not pay. Result so far: it shows in the browser.
2. Pay that order in the browser and watch whether the card disappears at once. Today's online payment (`completePaymentFromUnits` in `firestore.ts`) finds every ticket in `preparing` or `ready` status and marks it served, and removes it from the station's `rtKdsTickets` document. Offline payment (`completePaymentOffline` in `offlinePayment.ts`) runs the same status query and marks the ticket document served. Ala carte pays immediately, so the kitchen card may be cleared before it is cooked.
3. Install the new APK (with the version label) on the cashier and kitchen tablets and repeat the pay test there.
4. For any item that never reaches the kitchen, check in the Firebase console whether it has a kitchen station that exists and is active: in `stores/{id}/inventory`, filter `isAddon == true` and `isActive == true`, and compare each `kitchenLocationId` with the active documents in `kitchenLocations`. The item-edit dialog (`edit-inventory-dialog.tsx`) requires a station for add-ons, so an add-on with none or with a station that no longer exists comes from older data. A ticket sent to a missing or inactive station has no card to show it.

Fix, depending on the result:
- **Paying clears the card:** do not mark ala carte tickets served at payment, so the kitchen marks them done. In both `completePaymentFromUnits` and `completePaymentOffline`, skip the ticket loop when `sessionData.sessionMode === 'alacarte'`. Both functions already have `sessionData` loaded. Dine-in behaviour is unchanged. The two void paths (`voidSession` in `firestore.ts` and `offlineVoid.ts`) are not changed on purpose, because a voided order must not be cooked.
- **Station missing or inactive:** correct the item or station setup in the manager screens. No code change.
- **Old APK:** install the current APK. No code change.

Accepted consequences of the payment fix, for ala carte only (v1 is replaced in about two months, so these are not worked around):
- A ticket the kitchen never taps stays on the kitchen screen until someone taps Served on it.
- Refunding or voiding a paid ala carte receipt does not cancel its kitchen ticket.
- Skipping the loop also skips what the loop writes at payment: the analytics changes (`kdsDeltas`, `rtKdsUpdates`) and the closed-ticket history. These happen later, when the kitchen taps Served. Serves after payment update the closed session document and are not in the receipt's analytics snapshot.
- The kitchen sync tool (`SyncKdsTicketsTool.tsx`) rebuilds station cards from every `preparing` or `ready` ticket in the last 3 days, closed sessions included, so an unserved ala carte ticket can reappear after a sync.

### Piece 4: One browser test and a device checklist

- Add Playwright as a dev tool. It opens the app in Chromium at fixed sizes and clicks through the screen.
- The test runs against the local dev server (port 9003) and signs in with the test cashier account on the test store. The login details come from `.env.test.local`, which git already ignores. They are never committed.
- One spec: at 1280x400 and 800x360, start an ala carte session (it needs only a customer name, so no package, table or flavors are required), open the add-ons screen, open a variant item, pick a variant, focus "Special instructions", and check that "Cancel" and "Add Item" lie inside both the visible window and the pop-up. This proves the pinned layout only. It does not open a keyboard, so it cannot prove the Android behaviour.
- The test names its session `ZZ-TEST-<time>` and never takes payment. It leaves the session open; a manager voids leftover `ZZ-TEST` sessions, because the cashier role cannot.
- A written checklist covers the real tablet: read the version label; add a variant item and type a note in landscape; close the keyboard by tapping outside and by the Back button; rotate with the keyboard open; open the cashier list and a session and type in their text boxes; add an ala carte item, pay, and watch the kitchen screen.

### Risks & Mitigations

*   **`adjustResize` changes the whole app.** Screens with fixed bars or text boxes near the bottom may lift or reflow. Mitigation: the checklist includes the cashier list and session screens. If a screen breaks, the fallback is the hook and shared modal, which does not need the manifest change.
*   **Drawer moves twice on phones.** Mitigation: `repositionInputs={false}` on this modal's drawer, and a phone check on the checklist.
*   **Pinned footer without window resize does not help.** Mitigation: both changes ship together, and the tablet test decides.
*   **Stranded ala carte tickets.** See the accepted consequences in piece 3.
*   **Online and offline payment must change together.** Both get the same one-line skip and the same two new tests.
*   **APK rollback.** Android refuses to install an older build over a newer one without uninstalling the app first, which would remove its local offline data. Keep the previous APK file and treat rollback as "build a new APK from the previous code", not "reinstall the old one".
*   **Live test store.** The browser test writes to the test store. It creates open ala carte sessions only, which a manager voids afterwards. The ala carte pay test is manual, creates one paid receipt on the test store, and uses a `ZZ-TEST` name.

## Alternatives Considered

### Alternative A: Shared `ResponsiveModal` plus a `visualViewport` hook, applied to every modal

*   **Pros**: Fixes the whole class of problem in one place. Works whether or not the Android window resizes, because the hook reads the visible height from the browser.
*   **Cons**: Eight new or changed files for the first modal, plus edits to `dialog.tsx` (imported by 68 files) and `drawer.tsx` (11 files). The hook's behaviour in the Android WebView is unproven, and a browser test cannot exercise it.
*   **Reason for Rejection**: Too large for a version due to be replaced in about two months, and unproven. It stays as the fallback if the tablet test of piece 2 fails.

### Alternative B: `adjustResize` only, with no change to the pop-up

*   **Pros**: One line in the manifest.
*   **Cons**: The buttons still sit at the end of a tall scrolling column. On a short landscape screen the column can be taller than the pop-up before the keyboard opens, so the buttons are still off screen.
*   **Reason for Rejection**: It fixes "buttons do not come back" and leaves "buttons are off screen". Piece 2 uses both parts.

### Alternative C: Load the app from the server so fixes reach tablets without a new APK

*   **Pros**: A fix would reach every tablet at once. It would remove the version mismatch between devices. The same applies to an over-the-air update service for the bundled files.
*   **Cons**: Today the app opens and runs offline from its bundled copy (`capacitor.config.ts` sets no `server.url`). Loading from a server would make the first screen depend on the network. An update service adds a vendor and a new failure mode.
*   **Reason for Rejection**: Trading offline use for faster fixes is a bigger decision than this work, and v2 replaces this app soon. The version label makes the mismatch visible without changing how the app loads.

### Alternative D: Make the kitchen screen show served tickets for ala carte

*   **Pros**: No change to the payment code.
*   **Cons**: It hides the cause. Tickets marked served by payment would look finished on every other screen, history and report. The kitchen would need a second rule to tell "served by payment" from "served by the kitchen".
*   **Reason for Rejection**: If payment is clearing the cards, that is the wrong step to run for ala carte. Fix it there, and only if the pay test confirms it.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

One rule runs through the list. Each behaviour change (steps 4, 5, 6, 7) has a test or a manual check that fails before the change and passes after it. Other steps are covered by `npm run typecheck`.

Order of work. Each phase ends with `npm run typecheck` and `npm test` passing.
- **Phase A (no code):** the ala carte pay test in the browser, and the tablet readings if remote inspect works.
- **Phase B:** steps 1-3, the version label.
- **Phase C:** steps 10-15 first (the test, which must fail on today's code), then steps 4-5 (the fix), then run the test again, then build the APK and run the device checklist (step 16).
- **Phase D:** steps 6-9, only if Phase A showed that payment clears the ala carte card and the card-lifetime question is answered yes.

### Target Files to Create/Modify

#### Piece 1: Version label

1. `src/components/shared/AppVersionLabel.tsx` (Create)
   *   **Type / Scope**: Small client component.
   *   **Proposed Changes**: On mount, if `Capacitor.isNativePlatform()` (from `@capacitor/core`) is true, call `App.getInfo()` from `@capacitor/app` and keep `version` and `build`. Render `"v{version} (build {build})"` as `text-xs text-muted-foreground` with `data-testid="app-version"`. Render nothing before mount, in a browser, and when the native call fails. File name follows the PascalCase convention of `src/components/shared`. No unit test; covered by the device checklist.

2. `src/app/login/page.tsx` (Modify)
   *   **Type / Scope**: Page.
   *   **Proposed Changes**: Render `AppVersionLabel` below the sign-up line, outside the form, so the version can be read before signing in.

3. `src/app/account/page.tsx` (Modify)
   *   **Type / Scope**: Page.
   *   **Proposed Changes**: Render `AppVersionLabel` as one more row on the account card.

#### Piece 2: Pinned footer and Android window resize

4. `src/components/cashier/family-order-modal.tsx` (Modify)
   *   **Type / Scope**: Modal for items with variants.
   *   **Proposed Changes**:
       *   Split the root of `FamilyOrderContent` (`<div className="grid gap-4 p-4">`) into two siblings inside a fragment: a body `<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4">` holding steps 1-4, and a footer `<div className="flex shrink-0 justify-end gap-2 border-t p-4">` holding the "Cancel" and "Add Item" buttons. Replace the `DialogFooter` with that footer. No change to prices, `handleAdd`, or the data passed to `onAdd`.
       *   Dialog branch: `DialogContent` keeps `sm:max-w-xl max-h-[85dvh]` and p-0, drops `overflow-y-auto`, and gains `flex flex-col overflow-hidden`. `DialogHeader` gains `shrink-0`.
       *   Drawer branch: `DrawerContent` gains `flex flex-col overflow-hidden` (it has `overflow-y-auto` and `max-h-[92dvh]` in `drawer.tsx`; the class here overrides it). `DrawerHeader` gains `shrink-0`. The `Drawer` root gets `repositionInputs={false}`.
       *   The "Special instructions" `Textarea` gets an `onFocus` handler that calls `scrollIntoView({ block: "center" })` on the element after about 250ms.
       *   Keep the default `role="dialog"` and `data-state` that the Android Back handler (`AndroidBackHandler.tsx`) looks for.

5. `android/app/src/main/AndroidManifest.xml` (Modify)
   *   **Type / Scope**: Android settings.
   *   **Proposed Changes**: Add `android:windowSoftInputMode="adjustResize"` to the `MainActivity` element. Build a new APK with the "Build Android APK" workflow (`.github/workflows/build-apk.yml`), install it on the Lenovo, and run the device checklist. If "Add Item" is still hidden with the keyboard open, or does not return after closing, record the readings and reopen piece 2 using the fallback in Non-Goals. This file has no phone-keyboard setting today; no other Android file changes.

#### Piece 3: Missing ala carte kitchen cards (Phase D, gated on the pay test)

6. `src/components/cashier/firestore.ts` (Modify)
   *   **Type / Scope**: Online payment, `completePaymentFromUnits`.
   *   **Proposed Changes**: Keep the existing status query (`preparing`, `ready`). Inside the transaction, where `sessionData` is already read, skip the loop over the fetched tickets (served status, served-quantity and analytics changes, station projection removal, closed-ticket history) when `sessionData.sessionMode === 'alacarte'`. Any other value, including a missing one, runs the loop as today. `voidSession` is not changed.

7. `src/components/cashier/offlinePayment.ts` (Modify)
   *   **Type / Scope**: Offline payment, `completePaymentOffline`.
   *   **Proposed Changes**: Same skip, using `sessionData.sessionMode`, which this function already loads before the ticket query. Today this path only flips the ticket document to `served`; it does not touch `rtKdsTickets`. A later "Served" tap on the kitchen screen is then ignored as already finalized, so the card sticks. With the skip, the ticket document stays open and the Served tap works. `offlineVoid.ts` is not changed.

8. `src/components/cashier/offlinePayment.test.ts` (Modify)
   *   **Type / Scope**: Unit test. The file already mocks `getDocs` and sets `sessionMode`.
   *   **Proposed Changes**: Two cases. An ala carte session with a `preparing` ticket makes no ticket `update`. A dine-in session with the same ticket still marks it served.

9. `src/components/cashier/gateway-checkout.test.ts` (Modify)
   *   **Type / Scope**: Unit test. The file already exercises `completePaymentFromUnits`.
   *   **Proposed Changes**: The same two cases for the online path.

#### Piece 4: One browser test and a device checklist

10. `package.json` (Modify)
    *   **Type / Scope**: Project config.
    *   **Proposed Changes**: Add `@playwright/test@^1.51` as a dev dependency (IndexedDB sign-in state needs 1.51 or later). Add scripts `test:e2e` and `test:e2e:report`. After installing, run `npx playwright install chromium`. The repo's lint script (`next lint`) does not run on the installed Next version, and no lint step is added.

11. `playwright.config.ts` (Create)
    *   **Type / Scope**: Test runner config.
    *   **Proposed Changes**: Load `.env.test.local` with `dotenv` at the top (Playwright loads no env file, and `dotenv` is already a dev dependency). Base URL `http://localhost:9003`. Two projects, both Chromium with `hasTouch` and `isMobile` on: 1280x400 and 800x360. A setup project signs in first. `webServer: { command: 'npm run dev', url: 'http://localhost:9003', reuseExistingServer: true }`. Start the dev server yourself first: `npm run dev` runs `rimraf .next`. Screenshots and traces are kept only for failures.

12. `e2e/.env.example` (Create)
    *   **Type / Scope**: Documentation of variables.
    *   **Proposed Changes**: Names only, no values: `TEST_CASHIER_EMAIL`, `TEST_CASHIER_PASSWORD`, `TEST_STORE_ID`, `TEST_VARIANT_ITEM` (the title of an add-on family with variants, as shown on its tile). The real values go in `.env.test.local`. The test store must hold one add-on family with variants, and the store must offer ala carte sessions.

13. `.gitignore` (Modify)
    *   **Type / Scope**: Git ignore rules.
    *   **Proposed Changes**: Add `e2e/.auth/`, `playwright-report/`, `test-results/`.

14. `e2e/auth.setup.ts` (Create)
    *   **Type / Scope**: Playwright setup.
    *   **Proposed Changes**: Open `/login`, fill `#email` and `#password` from the environment, click the "Login" button, wait for the cashier page, set `localStorage.activeStoreId` to `TEST_STORE_ID` and reload, and save the signed-in state to `e2e/.auth/cashier.json`. Firebase keeps its login in IndexedDB, so the save must include IndexedDB. Fail with a message that names the missing variable if any is unset.

15. `e2e/family-modal-keyboard.spec.ts` (Create)
    *   **Type / Scope**: Playwright test.
    *   **Proposed Changes**: Start an ala carte session from `/cashier` (the "Ala Carte" tab, "Customer Name" set to `ZZ-TEST-<time>`, the "Create Order & Add Items" button), open `/cashier?sessionId=<id>`, press "Add Add-on", tap the tile titled `TEST_VARIANT_ITEM`, pick the first variant (the note box is disabled until one is picked), focus "Special instructions", and use hard `expect` assertions that the "Cancel" and "Add Item" buttons lie inside the visible window and inside the pop-up's own box. The pop-up and its body are found with `data-testid="family-order-modal"` and `"family-order-body"`, added in step 4. The test never takes payment and leaves the session open for a manager to void. Run before steps 4-5 to see it fail, then after to see it pass. It proves the pinned layout in a short window, not the Android keyboard.

16. `docs/qa/cashier-device-checklist.md` (Create)
    *   **Type / Scope**: Staff checklist for the real tablet.
    *   **Proposed Changes**: Steps in plain language, each with a pass or fail box and a place to write the build number: read the version label; add a variant item and type a note in landscape; close the keyboard by tapping outside and by the Back button (the first Back press may only hide the keyboard, and the second closes the pop-up); rotate with the keyboard open; repeat on a phone; open the cashier list and a session and type in their text boxes; add an ala carte item, pay, and watch the kitchen screen. Fields at the top for the Lenovo model and Android version, and, if remote inspect works, for `innerHeight` and `visualViewport.height` with the keyboard open and closed.

#### Not changed, on purpose

*   `src/app/kitchen/page.tsx` and `src/components/kitchen/*`: the kitchen reads each station's `rtKdsTickets` document, and the payment step removes tickets from it. The fix is on the payment side. If the pay test shows the card still disappears after steps 6-7, reopen this.
*   `dialog.tsx`, `drawer.tsx`, `ModifierPicker`, `AddonsPOSModal`, the payment pop-up, and `ServerPageClient.tsx`: not edited (see Non-Goals).
*   `voidSession` in `firestore.ts` and `offlineVoid.ts`: a voided order must not be cooked, so they still clear tickets.
*   `.github/workflows/build-apk.yml`: the build number already comes from the GitHub run number.

### Verification Plan

*   **Compilation/Build**: `npm run typecheck`.
*   **Unit Tests**: `npm test`. New cases are in steps 8 and 9 and run only in Phase D.
*   **E2E**: `npm run test:e2e` against the test store. The keyboard case must fail before steps 4-5 and pass at 1280x400 and 800x360 after.
*   **Real tablet, new APK (manual)**: build the APK, install it on the Lenovo with the build number written down, and run `docs/qa/cashier-device-checklist.md`. If "Add Item" is still hidden or does not return, record the readings and use the fallback in Non-Goals.
*   **Ala carte pay test (manual)**: add an ala carte item with a kitchen station on the test store and pay, first in the browser, then on the tablet with the new APK. Before steps 6-7: note whether the card disappears at once. After: the card stays until the kitchen taps Served. Then pay an offline ala carte order, reconnect, and confirm the card is still on the kitchen screen and the Served tap clears it. This creates paid receipts on the test store; name them `ZZ-TEST`.
*   **Station check (manual)**: for any item that never reaches the kitchen, run the console check in piece 3, step 4.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
