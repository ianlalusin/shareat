# Daily Metrics — What POS Measures, For Forwarding To ERP

## Context

POS used to compute a deterministic metrics digest each night, then hand it
to Gemini to write a narrated "AI brief" for managers (badge, modal, a
`/admin/insights` page, and cashier/server/kitchen shift-start popups). That
AI-generation layer was retired on 2026-08-08 — ERP now owns AI brief
generation and display. The **measurement** layer was kept and is still
computed daily, because that's the data ERP needs forwarded to it instead.

This doc inventories every avenue POS currently measures/investigates for
this purpose, where it's computed, and where it lives in Firestore, so
whoever wires up the ERP forwarding knows exactly what's available without
re-reading the source.

**Not covered here:** POS still owns two other AI features independent of
this retirement — sales forecasting (`stores/{id}/salesForecasts/{date}`,
Gemini-generated) and holiday-calendar generation
(`stores/{id}/holidayCalendar/{year}`, also Gemini-generated). Those were
explicitly kept in scope for POS and are not part of this handoff.

## Primary artifact: `stores/{storeId}/dailyMetrics/{dayId}`

Written once per store per day by the `generate-daily-insight` cron
(`/api/cron/generate-daily-insight`, fires `0 1-5 * * *` Asia/Manila,
idempotent/batched — see `docs/CRON.md`). `dayId` is `YYYYMMDD` for
**yesterday** (Asia/Manila). Computed for **every active store**, regardless
of any per-store AI toggle — the old `aiEnabled` gate only ever meant "will
this store's AI brief run"; since there's no brief anymore, this digest isn't
gated by it (that flag still gates POS's forecast/holiday-calendar features).

Type: `DailyMetricsDigest` in `src/lib/types.ts`. Shape:

```ts
{
  dayId: string;             // YYYYMMDD, the analyzed day
  storeId: string;
  status: "ok" | "no_data" | "error";
  source: "manual" | "cron";
  generatedAt: Timestamp;
  generatedAtMs: number;
  sales: InsightMetric[];
  operations: InsightMetric[];
  inventory: InsightMetric[];
  anomalies: InsightMetric[];
  digestText?: string;       // plain-text rollup of everything below
  error?: string | null;     // populated only when status === "error"
}
```

Each `InsightMetric` is `{ label, value, sub?, direction? }` — `value` is
pre-formatted (₱, %, min, count), `sub` is a comparison string (e.g. "+12%
vs 7-day avg"), `direction` is `"up" | "down" | "flat" | null`. These are
display-ready strings, not raw numbers — if ERP needs raw numeric values
instead, compute from the underlying `analytics` doc fields listed below
rather than parsing these strings.

`status: "no_data"` means no sales were recorded that day (all metric arrays
are empty) — not a failure. `status: "error"` means the computation itself
threw (Firestore read failure, etc.) — `error` holds the message; no metrics
were computed that day.

Computed in `src/lib/server/daily-metrics-digest.ts` (`computeDailyMetricsForStore`,
`buildMetricsAndDigest`, `computeStaffOps`, `buildAssistanceMetrics`).

## What's measured, section by section

### Sales
| Metric | Meaning | Source (on yesterday's `analytics/{dayId}` doc unless noted) |
|---|---|---|
| Net sales | Gross sales, + vs previous day | `payments.totalGross` |
| vs same weekday | Avg gross on the same weekday over the trailing ~3 weeks | `payments.totalGross` across the 21-day history read |
| vs 7-day avg | Avg gross over the prior 7 days | same history read |
| Transactions | Transaction count, + vs previous day | `payments.txCount` |
| Avg basket | Gross ÷ transactions, + vs previous day | derived |
| Covers | Guest count, + vs same-weekday avg | `guests.guestCountFinalTotal` |
| Dine-in / Walk-in | Transaction split | `payments.txCountByMode.dineIn` / `.walkIn` |
| vs forecast | Actual vs the AI sales forecast for the same date | this doc vs `salesForecasts/{date}.projectedSales` (forecast feature output, read-only here) |
| 7-day trend | % change, recent-7 vs prior-7 avg gross | derived from 21-day history |
| Top / lowest-selling package | By sales amount | `sales.packageSalesAmountByName` |
| Peak hour | Highest-grossing hour | `sales.salesAmountByHour` |
| Top payment method | By amount | `payments.byMethod` |

Also tracked (in `digestText` only, not a discrete chip): a momentum note when
sales have risen/fallen 2+ days in a row.

### Operations
| Metric | Meaning | Source |
|---|---|---|
| Avg time to attend | Seat → server confirm, avg | `server.confirmMsSum` / `server.confirmCount` |
| Avg dine-in session | Session duration, avg | `sessions.dineInDurationMsSum` / `.dineInDurationCount` |
| Avg kitchen serve | Order → served, avg | `kitchen.durationMsSumByType` / `.durationCountByType` (summed across types) |
| Busiest hour | By session count | `sales.sessionCountByHour` |
| Sessions closed | Count | `sessions.closedCount` |
| Kitchen cancels | Count | `kitchen.cancelledCountByType` (summed) |
| Fastest to confirm (per staff) | Per local-user-id avg server-confirm time, min 3 samples | `server.confirmMsSumByUser` / `.confirmCountByUser`, names via `staffNames` |
| Fastest kitchen serve (per staff) | Same, for kitchen serving | `kitchen.servingMsSumByUser` / `.servingCountByUser` |
| Assistance requests / avg response / slowest / answered ≤2 min / top handler | Customer "need assistance" tap responsiveness | `stores/{id}/customerRequests` (same collection `/admin/customer-requests` reads directly) for the calendar day |

### Inventory (menu-item sell-through, not raw stock levels)
| Metric | Meaning | Source |
|---|---|---|
| Fastest / slowest add-on | By quantity sold | `sales.addonSalesByItem[*].qty` |
| Top refill | By quantity served | `refills.servedRefillsByName` |
| Top package (qty) | By quantity sold | `sales.packageSalesQtyByName` |

### Anomalies / watch
| Metric | Meaning | Source |
|---|---|---|
| Voided / Discounts / Free items | Amount + qty, % of gross | `items.voidedAmount`/`voidedQty`, `discountedAmount`/`discountedQty`, `freeAmount`/`freeQty` |
| Refunds | Total + count | `items.refundTotal` / `refundCount` |
| Comps & leakage | (void+discount+free) as % of gross, vs a 14-day trailing baseline | derived from `items.*` across the 21-day history |
| Extra charges | Total | `payments.chargesTotal` |
| Idle hours | Hours with zero sessions inside the store's own active window that day | derived from `sales.sessionCountByHour` |

## Underlying raw collections (if ERP wants more than the digest)

- **`stores/{id}/analytics/{dayId}`** — the source of everything above. One
  doc per store per day; the digest cron reads 21 days of history per store
  per run (yesterday + 20 prior days) to compute trends/baselines.
- **`stores/{id}/customerRequests`** — raw assistance-tap events, filtered by
  `createdAtClientMs` for the target day.
- **`stores/{id}/salesForecasts/{date}`** — AI-generated forecast (kept
  feature); the digest only reads `projectedSales` for the "vs forecast"
  comparison.
- **`stores/{id}/weatherForecasts/{YYYY-MM}`**, **`weatherRecords/{dayId}`** —
  weather data (OpenWeatherMap, no AI). Previously fed into the AI brief's
  narrative context; the metrics digest no longer reads these (nothing
  narrates them anymore), but they're logged independently daily
  (`log-weather` cron) and available for ERP to pull directly if weather
  correlation is wanted.
- **`stores/{id}/dailyContext/{dayId}`** — payday/holiday flags for that day.
  Same story: was narrative context for the old brief, not read by the
  digest anymore, still populated and available independently.

## What changed, for anyone diffing against the old system

- **Retired**: Gemini calls, the AI-narrated `headline`/`narrative`/`flags`/
  `summary`/`suggestions` fields, token/cost tracking, the manual "Regenerate"
  button and its route, and all display UI (floating badge, shift-start
  popup, `/admin/insights` page).
- **Kept, unchanged in shape**: every metric listed above — same computation,
  same field names, same source data.
- **Renamed**: `stores/{id}/aiInsights/{dayId}` → `stores/{id}/dailyMetrics/{dayId}`;
  `system/insightCronLog` → `system/dailyMetricsCronLog`. Old `aiInsights`
  docs are left in place as a historical archive (last written under the old
  system) — nothing reads or writes them anymore.
- **Newly unconditional**: the digest now computes for every active store,
  not just AI-enabled ones (see rationale above).
