# Changelog

## VAT discount math cutover — merged 2026-06-12 (`security-hardening`)

**H-1 fix changes how discounts are reported on VAT-inclusive stores.** Discounts
now apply to the gross (VAT-inclusive) shelf price instead of the VAT-exclusive
base. This is the correct behavior, but it has a reporting consequence:

- On VAT-inclusive stores, `discountsTotal` (and the per-receipt discount lines)
  will be **~12% higher** than before for the same discount — e.g. a 10% discount
  on a ₱112 item is now ₱11.20, where the old code recorded ₱10.00.
- **The cutover is the production deploy date** (the App Hosting rollout that ships
  this change), not the merge date. Receipts created before that rollout keep their
  own stored totals; only new receipts use the corrected math.
- **Do NOT retro-rebuild historical analytics.** Receipts are self-describing
  (each carries its own totals snapshot). Rebuilding would re-apply the new
  definition to old receipts and distort history.
- Dashboards that span the cutover therefore mix two discount definitions. When
  comparing discount totals across the boundary, account for this.

**H-2** added senior/PWD VAT-exempt support (a `vatExempt` discount flag); exempt
sales now compute `vatExemptSales`/`vatableSales`, persist them on the receipt,
and print them (previously hard-coded to ₱0.00). No historical impact — old
receipts fall back to the prior derivation at render time.
