import { test as setup, expect } from "@playwright/test";
import { AUTH_FILE, expectCashierPage, need, operatorGrantKey, signInToTestStore } from "./helpers";

// Starts from an empty browser. A cashier login alone only reaches the local-user
// sign-in gate, so this also signs in the dedicated test operator through the real
// profile + passcode flow. The saved state carries the server-issued operator grant;
// nothing is fabricated and no admin account is used.
setup("sign in as the test cashier and test operator", async ({ page }) => {
  const email = need("TEST_CASHIER_EMAIL");
  const password = need("TEST_CASHIER_PASSWORD");
  const storeId = need("TEST_STORE_ID");
  const operator = need("TEST_OPERATOR_PROFILE");
  const passcode = need("TEST_OPERATOR_PASSCODE");
  if (!/^\d{6}$/.test(passcode)) throw new Error("TEST_OPERATOR_PASSCODE must be the 6-digit passcode.");

  await signInToTestStore(page, email, password);

  // The gate opens the profile picker by itself.
  const picker = page.getByRole("dialog").filter({ hasText: "Who's using this tablet?" });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await picker.getByRole("button").filter({ has: page.getByText(operator, { exact: true }) }).click();

  const pad = page.getByRole("dialog").filter({ hasText: `Enter passcode for ${operator}` });
  await expect(pad).toBeVisible();
  for (const digit of passcode) {
    await pad.getByRole("button", { name: digit, exact: true }).click();
  }
  await expect(pad, "passcode was not accepted").toBeHidden({ timeout: 30_000 });

  await expectCashierPage(page);
  const grant = await page.evaluate((key) => localStorage.getItem(key), operatorGrantKey(storeId));
  expect(grant, "no operator grant was stored after sign-in").toContain('"token"');

  // Firebase keeps the login in IndexedDB and the operator grant in localStorage.
  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
});
