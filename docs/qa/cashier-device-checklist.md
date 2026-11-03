# Cashier device checklist (keyboard and window resize)

Run this on the real Lenovo tablet after installing the new APK. A browser cannot show how the Android keyboard behaves, so this list is the real proof.

Keep it separate from the browser test (`npm run test:e2e`, see `e2e/.env.example`). A passing browser run proves the pinned layout in a short window only; it does not fill in or replace any step here.

Fill in the header first.

- Tester:
- Date:
- Lenovo model:
- Android version:
- APK build number (read it from the version label, see step 1):
- Remote inspect works over USB? yes / no

If remote inspect works, also write down, with the keyboard closed and then open (tap the note box):

| | Keyboard closed | Keyboard open |
|---|---|---|
| `window.innerHeight` | | |
| `visualViewport.height` | | |

Meaning: if `innerHeight` does not change when the keyboard opens, the window did not resize ("no resize"). If it shrinks and does not return after closing, that is "no recovery". The new Android setting should fix both.

## Steps

Mark each step pass or fail. Write what happened for any fail.

| # | Step | Pass | Fail | Notes |
|---|---|---|---|---|
| 1 | Open the login screen or the account page. A small label like "v1.0 (build 57)" is shown. | | | |
| 2 | Landscape. Open a dine-in or ala carte session. Tap an item that has variants. The pop-up opens. | | | |
| 3 | Pick a variant. Tap "Special instructions". The keyboard opens. "Cancel" and "Add Item" are both still on screen above the keyboard. | | | |
| 4 | Type a note. The note box is visible while typing. | | | |
| 5 | Close the keyboard by tapping outside the note box. "Cancel" and "Add Item" are still visible. | | | |
| 6 | Tap the note box again, then press the Back button. The first press may only hide the keyboard. Press Back again. The pop-up closes. | | | |
| 7 | Open the pop-up again, tap the note box, rotate the tablet to portrait and back with the keyboard open. The buttons stay visible. | | | |
| 8 | Tap "Add Item". The line is added to the bill with the note. | | | |
| 9 | Repeat steps 2 to 5 on a phone (drawer layout). The drawer does not jump or move twice. | | | |
| 10 | Open the cashier list and type in its search box. The screen is not broken or covered by the keyboard. Close the keyboard and it returns to normal. | | | |
| 11 | Open a session and type in a text box there (for example the session note). Same check as step 10. | | | |
| 12 | Open the add-ons screen, select an item, tap the note box. "Add to Order" stays visible. | | | |
| 13 | Ala carte: add an item that has a kitchen station, pay it, and watch the kitchen screen. Write whether the card disappears at once. Name the customer `ZZ-TEST`. | | | |

## If a step fails

- Steps 3 to 7 fail: write down the readings above and tell Ian. The fallback is the viewport hook and shared modal described in the design's Non-Goals.
- Step 9 fails (drawer moves twice): tell Ian.
- Steps 10 or 11 fail: the new Android setting affects the whole app. Tell Ian which screen broke.
