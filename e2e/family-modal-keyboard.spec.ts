import { test, expect, type Locator, type Page } from "@playwright/test";

// Proves the pinned footer: with a short window (stand-in for "keyboard open"),
// "Cancel" and "Add Item" must lie inside both the window and the pop-up itself.
// It does NOT open a keyboard. The Android behaviour is checked on the real tablet
// with docs/qa/cashier-device-checklist.md.
//
// The test starts an ala carte session named ZZ-TEST-<time> and never takes payment.
// The cashier role cannot void sessions, so a manager voids leftover ZZ-TEST sessions.

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to .env.test.local (see e2e/.env.example).`);
  return value;
}

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

async function startAlaCarteSession(page: Page) {
  await page.goto("/cashier");
  const alaCarteTab = page.getByRole("tab", { name: "Ala Carte" });
  await alaCarteTab.click();
  await page.getByLabel("Customer Name").fill(`ZZ-TEST-${Date.now()}`);
  await page.getByRole("button", { name: /Create Order & Add Items/ }).click();
  await expect(page).toHaveURL(/sessionId=/, { timeout: 30_000 });
}

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
