# Void double-count fix — June 27 2026 dashboard drift

## Symptom
SharEat Lipa (SELIP) dashboard running sales for **2026-06-27** read **₱36,746.60**,
but the actual sales (Excel export, voided receipt excluded) were **₱40,249.60** —
short by exactly **₱3,503**, the amount of the voided receipt **SELIP-5471**.

## Root cause
The paid receipt **SELIP-5471** was voided **twice** (two `RECEIPT_VOIDED` activity
logs, 0.8 s apart, actor "Lora", reason "grab order cancel"), and the analytics
sale was reversed **twice**.

`handleVoidReceipt` (`src/components/receipts/page.tsx`) defeated the server route's
idempotency guard on every call:
- the "already voided?" check read the **stale in-memory** `receipt.status`, so a
  second trigger (second tab/device, retry, slow first attempt) still proceeded;
- it then **unconditionally wrote `analyticsReversed: false`** right before the
  reversal, **re-arming** the `apply-delta` route's guard (`if analyticsReversed ===
  true skip`), so the sale was subtracted a second time.

Arithmetic on the live `analytics/20260627` doc:
`40,249.60 (35 real receipts) + 3,503 (applied) − 3,503 (reverse #1) − 3,503 (reverse #2) = 36,746.60`,
`txCount = 35 + 1 − 1 − 1 = 34`, `salesAmountByHour["16"] = +3503 − 3503 − 3503 = −3,503`.
All three matched the stored doc. June 26 was clean (earlier UTC-day-split theory ruled out).

## TODO / status

- [x] Diagnose via live Firestore (read-only) — confirmed double reversal, not a TZ split.
- [x] **Code fix:** make the receipt void atomic + idempotent. The status flip +
      `analyticsReversed:false` reset now run inside a `runTransaction` that re-reads
      the live doc and aborts if already `voided`; only the call that flips
      `final → voided` reverses analytics and writes the `RECEIPT_VOIDED` log.
      (`src/components/receipts/page.tsx`)
- [x] **Data correction:** rebuilt `analytics/20260627` from receipts (voided receipt
      excluded) + 8 dashboard presets via
      `scripts/settle-payment-mix-drift.ts --storeId=L5MExycvUOfQ96Y10FqF --date=2026-06-27 --apply`.
      netSales **36,746.60 → 40,249.60**. No `voidCashRetainedTotal` to preserve.
- [ ] **Deploy** the code fix (until shipped, the double-void can recur on other paid receipts).
- [ ] **Historical sweep:** scan all stores for receipts with two `RECEIPT_VOIDED`
      logs; for each affected day, rebuild from receipts with the same script.
- [ ] Consider a server-side guard: reject a `RECEIPT_VOIDED` op when the receipt
      doc is already `status:"voided"` (defense in depth beyond the client transaction).

## Remediation command (per affected day)
```
FIREBASE_ADMIN_SA_PATH=<sa.json> \
  npx tsx scripts/settle-payment-mix-drift.ts \
  --storeId=<storeId> --date=YYYY-MM-DD --apply
```
Rebuilds the day analytics + dashboard presets from receipts (skips voided receipts).
Run without `--apply` first for a read-only dry-run.
