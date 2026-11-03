import { expect, type Page } from "@playwright/test";

export const AUTH_FILE = "e2e/.auth/cashier.json";

/** Reads a required variable. Fails fast so a half-configured run never touches a store. */
export function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.test.local (see e2e/.env.example).`);
  return value;
}

/** The device-local operator grant the app keeps per store (see useServerProfile keyFor). */
export const operatorGrantKey = (storeId: string) => `shareat:serverProfile:${storeId}`;

/**
 * Firebase email/password login, then point the app at the designated test store and
 * prove it is the active one by its name in the header. Refuses to run without
 * TEST_STORE_ID and TEST_STORE_NAME, so a run can never fall back to a real store.
 */
export async function signInToTestStore(page: Page, email: string, password: string) {
  const storeId = need("TEST_STORE_ID");
  const storeName = need("TEST_STORE_NAME");

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

  // The app remembers the active store here; point it at the test store and reload.
  await page.evaluate((id) => localStorage.setItem("activeStoreId", id), storeId);
  await page.goto("/cashier");

  // If the account cannot see the test store, the app silently picks another one.
  await expect(
    page.locator("header").getByText(storeName, { exact: true }).first(),
    `the active store is not "${storeName}" (TEST_STORE_ID=${storeId}); the account may lack access`,
  ).toBeVisible({ timeout: 30_000 });
}

/** Real cashier page, not the local-user sign-in gate. */
export async function expectCashierPage(page: Page) {
  await expect(page.getByRole("button", { name: "Expand new session", exact: true })).toBeVisible({ timeout: 30_000 });
}
