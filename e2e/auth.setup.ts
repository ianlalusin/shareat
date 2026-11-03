import { test as setup, expect } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/cashier.json";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.test.local (see e2e/.env.example).`);
  return value;
}

setup("sign in as the test cashier", async ({ page }) => {
  const email = need("TEST_CASHIER_EMAIL");
  const password = need("TEST_CASHIER_PASSWORD");
  const storeId = need("TEST_STORE_ID");

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });

  // The app remembers the active store here; point it at the test store.
  await page.evaluate((id) => localStorage.setItem("activeStoreId", id), storeId);
  await page.goto("/cashier");
  await expect(page).toHaveURL(/\/cashier/);

  // Firebase keeps the login in IndexedDB, so the saved state must include it.
  await page.context().storageState({ path: AUTH_FILE, indexedDB: true });
});
