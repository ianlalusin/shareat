import { test, expect, type Browser, type Locator, type Page } from "@playwright/test";
import { expectCashierPage, need, signInToTestStore } from "./helpers";

// Proves the pinned footer: with a short window (stand-in for "keyboard open"),
// "Cancel" and "Add Item" must lie inside both the window and the pop-up itself.
// It does NOT open a keyboard. The Android behaviour is checked on the real tablet
// with docs/qa/cashier-device-checklist.md.
//
// The test starts an ala carte session named ZZ-TEST-<time> on the designated test
// store and never takes payment. The cashier role cannot void, so afterEach signs in
// the dedicated cleanup manager in a separate browser and voids that session.

async function expectInside(inner: Locator, outer: { x: number; y: number; width: number; height: number }, label: string) {
  const box = await inner.boundingBox();
  expect(box, `${label} has no box (not rendered)`).not.toBeNull();
  const b = box!;
  const tol = 1;
  expect(b.y, `${label} top is above the area`).toBeGreaterThanOrEqual(outer.y - tol);
  expect(b.y + b.height, `${label} bottom is below the area`).toBeLessThanOrEqual(outer.y + outer.height + tol);
  expect(b.x, `${label} left is outside the area`).toBeGreaterThanOrEqual(outer.x - tol);
  expect(b.x + b.width, `${label} right is outside the area`).toBeLessThanOrEqual(outer.x + outer.width + tol);
}

/** Session names this test created and has not voided yet. */
const created: string[] = [];

async function startAlaCarteSession(page: Page) {
  await page.goto("/cashier");
  await expectCashierPage(page);

  // The New Session accordion starts closed; the form lives inside it.
  await page.getByRole("button", { name: "Expand new session", exact: true }).click();
  const createButton = page.getByRole("button", { name: /Create Order & Add Items/ });
  const unlimitedTab = page.getByRole("tab", { name: "Unlimited" });
  const alaCarteTab = page.getByRole("tab", { name: "Ala Carte" });
  await expect(unlimitedTab.or(createButton).first(), "the New Session form did not open").toBeVisible();

  // Tabs render only when the store offers both modes. Without them the store must be
  // declared ala-carte-only, otherwise the visible form may be the dine-in one.
  if (await alaCarteTab.count()) {
    await expect(unlimitedTab).toBeVisible();
    await alaCarteTab.click();
  } else if (process.env.TEST_STORE_ORDER_MODES !== "alacarte") {
    throw new Error(
      "The test store does not show both order-mode tabs. Enable Unlimited and Ala Carte on it, " +
        "or set TEST_STORE_ORDER_MODES=alacarte if it is deliberately ala-carte-only.",
    );
  }

  const name = `ZZ-TEST-${Date.now()}`;
  const form = page.locator("form").filter({ has: createButton });
  await expect(form).toBeVisible();
  // First field of the ala carte form is "Customer Name" (its label is not bound to the input).
  await form.locator("input").first().fill(name);
  await createButton.click();
  await expect(page).toHaveURL(/sessionId=/, { timeout: 30_000 });
  created.push(name);
}

/** Voids this test's sessions as the cleanup manager, in a fresh browser (managers skip the operator gate). */
async function voidCreatedSessions(browser: Browser) {
  if (created.length === 0) return;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signInToTestStore(page, need("TEST_CLEANUP_MANAGER_EMAIL"), need("TEST_CLEANUP_MANAGER_PASSWORD"));
    while (created.length) {
      const name = created[0];
      const card = page.locator("div.group").filter({ has: page.getByText(name, { exact: true }) });
      await card.hover();
      await card.getByRole("button", { name: "Void" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("#void-reason").fill("E2E test cleanup");
      await dialog.getByRole("button", { name: "Confirm Void" }).click();
      await expect(card, `could not void ${name}; void it by hand`).toHaveCount(0, { timeout: 30_000 });
      created.shift();
    }
  } finally {
    await context.close();
  }
}

test.beforeAll(() => {
  // Refuse to start anything without the test store and a way to clean up afterwards.
  for (const name of ["TEST_STORE_ID", "TEST_STORE_NAME", "TEST_CLEANUP_MANAGER_EMAIL", "TEST_CLEANUP_MANAGER_PASSWORD"]) need(name);
});

test.afterEach(async ({ browser }) => {
  await voidCreatedSessions(browser);
});

test("variant pop-up keeps Cancel and Add Item visible when the note box is focused", async ({ page }) => {
  const variantItem = need("TEST_VARIANT_ITEM");

  await startAlaCarteSession(page);
  await page.getByRole("button", { name: /Add Add-on/ }).click();
  await page.getByText(variantItem, { exact: true }).first().click();

  const modal = page.getByTestId("family-order-modal");
  await expect(modal).toBeVisible();

  // The note box is disabled until a variant is picked.
  await page.getByTestId("family-order-body").getByRole("button").first().click();
  const note = modal.getByPlaceholder(/no onions/i);
  await expect(note).toBeEnabled();
  await note.click();
  await page.waitForTimeout(400); // let the focus scroll settle

  const viewport = page.viewportSize()!;
  const modalBox = await modal.boundingBox();
  expect(modalBox, "pop-up has no box").not.toBeNull();
  const screen = { x: 0, y: 0, width: viewport.width, height: viewport.height };

  for (const name of ["Cancel", "Add Item"]) {
    const button = modal.getByRole("button", { name, exact: true });
    await expectInside(button, screen, `"${name}" in the window`);
    await expectInside(button, modalBox!, `"${name}" in the pop-up`);
  }
});
