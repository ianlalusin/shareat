# Scheduled Jobs

## Active-store list caching

`reconcile-analytics` and `holiday-calendar` both fire every 15 minutes, and
`log-weather` hourly — each of them (plus `generate-forecast`,
`update-accuracy`, `rebuild-presets`, `generate-daily-insight`, and the
external `/api/external/stores` API) used to independently run
`stores` WHERE `isActive == true` to get the active-store list. That query
pattern was the top hit in Firestore's index usage panel purely from this
fan-out — none of these jobs process enough stores for the query itself to be
expensive, it was just firing ~230+ times/day combined.

All of them now call `getActiveStores(db)`
(`src/lib/server/active-stores-cache.ts`), which caches the full active-store
list in `system/activeStoresCache` for 15 minutes. Whichever job fires first
after the cache expires pays for the real collection scan and repopulates it;
every job that fires within the next 15 minutes reads one cheap doc instead.
The TTL matches the tightest existing cron cadence, so no job waits longer for
a store activation/deactivation to take effect than it already implicitly did
before this cache existed. The cache is self-healing (a missing or expired doc
just triggers a fresh scan) and server-only — `system/*` is excluded from the
client catch-all in `firestore.rules`, so it's never reachable from the app.

## The scheduled endpoints

The dashboard's forecast + accuracy cards depend on two endpoints that run on a
daily schedule. The endpoints live in this Next.js app under `src/app/api/cron/`
and are deployed alongside the rest of the backend on **Firebase App Hosting**.
Firebase App Hosting does not honour `vercel.json`, so the schedule is owned
externally by **Google Cloud Scheduler**.

## The two jobs

| Job name                   | Endpoint                            | Schedule (Asia/Manila)          | Attempt deadline |
| -------------------------- | ----------------------------------- | ------------------------------- | ---------------- |
| `update-forecast-accuracy` | `GET /api/cron/update-accuracy`     | `0 20 * * *` (8 PM)             | 180s             |
| `generate-forecast`        | `GET /api/cron/generate-forecast`   | `0 21,22,23,0,1 * * *` (9 PM–1 AM) | 600s         |
| `generate-daily-insight`   | `GET /api/cron/generate-daily-insight` | `0 1-5 * * *` (1–5 AM, batched) | 300s          |
| `log-weather`              | `GET /api/cron/log-weather`         | `0 * * * *` (hourly)            | 120s             |
| `reconcile-analytics`      | `GET /api/cron/reconcile-analytics` | `*/15 * * * *` (every 15 min)   | 120s             |
| `rebuild-presets`          | `GET /api/cron/rebuild-presets`     | `30 0 * * *` (12:30 AM)         | 300s             |
| `holiday-calendar`         | `GET /api/cron/holiday-calendar`    | `*/15 * * * *` (every 15 min)   | 120s             |

`log-weather` polls OpenWeatherMap once per active store (geotagged via the store
editor) and upserts each day's forecast into the monthly doc
`stores/<storeId>/weatherForecasts/<YYYY-MM>`. The sales forecast reads those docs
— it never calls the weather API itself, keeping usage well under the free tier.
Stores without a geotag are skipped.

`holiday-calendar` processes ONE "due" store per fire. A per-store AI holiday/
occasion calendar is generated (`stores/<storeId>/holidayCalendar/<YYYY>`,
Gemini, prior+current year so last year seeds learning) and the store's learned
holiday lifts are recomputed deterministically into
`stores/<storeId>/holidayEffects/summary`. "Due" = an active AI store not yet in
`system/holidayCronLog.weeks[<ISO-week>].doneStoreIds`; once all are done the
fires are cheap no-ops until the next ISO week, giving a ≈weekly refresh that
also catches newly-proclaimed special days. Reuses `CRON_SECRET` + `GEMINI_API_KEY`.

`generate-forecast` fires up to five times because the route self-deduplicates
via `system/forecastCronLog.runs[<date>]` — the first successful run marks the
day "success" and later attempts short-circuit. The extra fires only exist as
fallbacks for transient Gemini or Firestore failures.

`generate-daily-insight` computes **yesterday's** performance per active store
— no AI involved — and writes `stores/<storeId>/dailyMetrics/<YYYYMMDD>`. This
used to feed an AI-narrated manager brief; that generation was retired in
favor of ERP's own AI brief (2026-08-08), so this route now only produces the
deterministic metrics digest ERP pulls from. Reuses `CRON_SECRET` (auth); no
Gemini call, no `GEMINI_API_KEY` dependency. See
`docs/erp-daily-metrics-forwarding.md` for what's measured.

**Cost control (forecast cron):** generation is **per-store idempotent** — a
store already done for the day is skipped (no Gemini call), so a single flaky
store never re-runs the whole fleet. Each fire processes only a small **batch**
of not-yet-done stores at low concurrency, so the work spreads across the
multiple off-peak fires and bursts stay under the Gemini rate limit. A day is
marked `success` only once every active store is done; otherwise it stays
`pending` and the next fire picks up the remainder / retries failures (capped
by `MAX_DAILY_ATTEMPTS`). The forecast tracks completed stores in
`system/forecastCronLog.runs[<date>].doneStoreIds`. `generate-daily-insight`
uses the same idempotent/batched shape (tracked in
`system/dailyMetricsCronLog`) purely to spread Firestore load, not for any
rate-limit reason — there's no model call left to throttle.

`reconcile-analytics` is the durable backstop for the analytics server lockdown
(M-1). Analytics rollups are server-write-only (Firestore rules), and the client
applies each delta through a server endpoint with retry. If a call still fails
transiently, the receipt is left with a pending flag — `analyticsApplied:false`
(payment/refund not applied) or `analyticsReversed:false` (void not reversed).
This job sweeps each active store for those via **cheap single-field queries**
(≈0 docs on a healthy system) and applies them with the same **idempotent**
server writer, so analytics is never permanently dropped. It reuses `CRON_SECRET`;
no new secret. (KDS ticket and receipt-edit deltas are not in this sweep — they
rely on endpoint retry plus the admin **Backfill** tool as the manual backstop.)

`rebuild-presets` re-sums the dashboard preset tiles (today / yesterday / last7 /
last30 / thisMonth / lastMonth / thisWeek / ytd) from the per-day analytics docs
for every active store, once daily. The live delta path only **adds** to a preset
doc for whichever windows include an event when it happens — it never rolls a day
back **off** once it leaves the rolling window, so the tiles inflate over time
(observed in prod: a "This Month" tile reading 3×–11× the true receipt total). The
per-day analytics docs are always correct (keyed by `dayId`), so re-summing them
resets the tiles; the deltas keep them live during the day. Reuses `CRON_SECRET`;
no new secret. Cheap (≈8 windowed reads per store).

## Auth

Both routes check `Authorization: Bearer <CRON_SECRET>`. The secret is declared
in `apphosting.yaml` and stored in Google Secret Manager. The same value lives
in `.env.local` for local development.

## Provisioning

You only need to do this once per environment. Substitute the placeholders.

```bash
PROJECT_ID=<your-gcp-project-id>
BACKEND_URL=https://<your-app-hosting-domain>
CRON_SECRET=<value from Secret Manager / .env.local>
REGION=asia-east1   # match your App Hosting region

gcloud config set project "$PROJECT_ID"
gcloud services enable cloudscheduler.googleapis.com   # one-time

gcloud scheduler jobs create http update-forecast-accuracy \
  --location="$REGION" \
  --schedule="0 20 * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/update-accuracy" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=180s

gcloud scheduler jobs create http generate-forecast \
  --location="$REGION" \
  --schedule="0 21,22,23,0,1 * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/generate-forecast" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=600s

gcloud scheduler jobs create http log-weather \
  --location="$REGION" \
  --schedule="0 * * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/log-weather" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=120s

gcloud scheduler jobs create http generate-daily-insight \
  --location="$REGION" \
  --schedule="0 1-5 * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/generate-daily-insight" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=300s

gcloud scheduler jobs create http reconcile-analytics \
  --location="$REGION" \
  --schedule="*/15 * * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/reconcile-analytics" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=120s

gcloud scheduler jobs create http rebuild-presets \
  --location="$REGION" \
  --schedule="30 0 * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/rebuild-presets" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=300s

gcloud scheduler jobs create http holiday-calendar \
  --location="$REGION" \
  --schedule="*/15 * * * *" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/holiday-calendar" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=120s
```

**Secrets**: `generate-daily-insight` needs only `CRON_SECRET` (already
declared in `apphosting.yaml`) — it no longer calls Gemini, so
`GEMINI_API_KEY` is not required for this route. Just ensure the new route is
deployed (rolled out) before creating the job.

**Weather key**: `log-weather` also needs `OPENWEATHER_API_KEY` (declared in
`apphosting.yaml`). Create + grant it before the first rollout, e.g.
`firebase apphosting:secrets:set OPENWEATHER_API_KEY`. Optionally set
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (build-time) to enable the live map in the
store geotag picker — without it the picker still accepts pasted coordinates.

Cloud Console equivalent: https://console.cloud.google.com/cloudscheduler →
**Create Job** → HTTP target → paste the URL and header as above.

## Verification

- `gcloud scheduler jobs run <name> --location=<region>` (or **Force Run** in the
  Console) should return HTTP 200 in the job's history.
- `system/forecastCronLog.runs.<YYYY-MM-DD>.status` should be `"success"` after
  the first good generate run of the day.
- `stores/<storeId>/salesForecasts/<today>` should have a fresh `createdAt`,
  `projectedSales`, and `confidence`. The accuracy job backfills `accuracy` and
  `actualSales` on prior days' docs.
- On `/dashboard`, the Weekly Sales chart, Forecast Accuracy Trend, and Today
  Forecast cards should update without anyone clicking **Refresh**.

## Related code

- `src/app/api/cron/generate-forecast/route.ts` — entry point, auth check.
- `src/app/api/cron/update-accuracy/route.ts` — entry point, auth check.
- `src/lib/server/generate-forecast.ts` — `runForecastWithTracking`,
  `generateForecastsForAllActiveStores`, `updateAccuracyForAllActiveStores`,
  `backfillRecentAccuracy`.
- `src/app/api/admin/refresh-forecast/route.ts` — the dashboard **Refresh**
  button. Shares `generateForecastForStore()` with the cron, so once Cloud
  Scheduler is wired the auto-update follows the exact code path the button
  already exercises.
