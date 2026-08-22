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
list in `system/activeStoresCache` for 20 minutes — deliberately above the
15-minute cadence, not equal to it, so a refresh is guaranteed to be reused by
the next same-cadence fire regardless of scan duration or Cloud Scheduler
jitter. A job that fires within the window reads one cheap doc instead of
scanning. The cache is self-healing (a missing or expired doc just triggers a
fresh scan) and server-only — `system/*` is excluded from both client
catch-alls in `firestore.rules`, so it's never reachable from the app.

**Known gap:** `reconcile-analytics` and `holiday-calendar` run on the exact
same `*/15 * * * *` schedule, so on a refresh tick both can still miss the
cache and scan concurrently — there's no lock, just a TTL. That's an accepted
tradeoff (a harmless duplicate scan+write once every couple of cycles) rather
than a distributed lock for a background read-cost optimization. Every other
consumer isn't aligned to that same instant and gets a real cache hit most of
the time. Offsetting one of the two schedules (e.g. `holiday-calendar` to
`7-59/15 * * * *`) would remove even that overlap, at the cost of a Cloud
Scheduler change outside this repo — not done here.

## The scheduled endpoints

The dashboard's forecast + accuracy cards depend on two endpoints that run on a
daily schedule. The endpoints live in this Next.js app under `src/app/api/cron/`
and are deployed alongside the rest of the backend on **Firebase App Hosting**.
Firebase App Hosting does not honour `vercel.json`, so the schedule is owned
externally by **Google Cloud Scheduler**.

## The two jobs

**Verified against production 2026-08-22** with
`gcloud scheduler jobs list --project=shareat-hub-v2`. The table below is what
actually exists, not what was originally planned — several schedules had drifted
from this doc. All jobs are `Asia/Manila`.

| Cloud Scheduler job | Endpoint | Schedule | Region | State |
| --- | --- | --- | --- | --- |
| `weather_api_call` | `GET /api/cron/log-weather` | `0 * * * *` (hourly) | asia-southeast1 | ENABLED |
| `generate-daily-insight` | `GET /api/cron/generate-daily-insight` | `0 1-5 * * *` (1–5 AM) | asia-southeast1 | ENABLED |
| `update-accuracy` | `GET /api/cron/update-accuracy` | `0 4 * * *` (4 AM) | asia-southeast1 | ENABLED |
| `generate-forecast` | `GET /api/cron/generate-forecast` | `0 5-9 * * *` (5–9 AM) | asia-southeast1 | ENABLED |
| `reconcile-analytics` | `GET /api/cron/reconcile-analytics` | `*/15 * * * *` | asia-southeast1 | ENABLED |
| `purge-expired-pins` | `GET /api/cron/purge-expired-pins?write=1` | `0 3 * * 0` (Sun 3 AM) | asia-southeast1 | ENABLED |
| `rebuild-presets` | `GET /api/cron/rebuild-presets` | `30 0 * * *` (12:30 AM) | **asia-east1** | ENABLED |
| `holiday-calendar` | `GET /api/cron/holiday-calendar` | — | — | **NO JOB EXISTS** |

Discrepancies this table corrects, all confirmed live:

- The job for `log-weather` is named **`weather_api_call`**, not `log-weather`.
- `update-accuracy` runs at **4 AM**, not 8 PM as previously documented.
- `generate-forecast` runs **5–9 AM**, not 9 PM–1 AM.
- Jobs are split across **two regions**: six in `asia-southeast1`, `rebuild-presets`
  alone in `asia-east1`. The provisioning snippet below defaults to
  `asia-southeast1` because that is where the majority live; check with
  `gcloud scheduler jobs list` before assuming a job's location, since
  `describe`/`pause`/`run` all require the right `--location`.
- URIs are also mixed: older jobs target the App Hosting default domain
  `https://shareat--shareat-hub-v2.asia-southeast1.hosted.app`, newer ones
  (`reconcile-analytics`, `rebuild-presets`, `purge-expired-pins`) target the
  custom domain `https://app.shareat.net`. Both resolve to the same backend.
- **`holiday-calendar` has no Cloud Scheduler job in any region** — the route
  exists in this repo and is described below, but nothing ever calls it, so the
  per-store holiday scan never runs. Consistent with the holiday-forecasting
  feature having been built but never rolled out. Either create the job or stop
  documenting it as scheduled; not decided here.

### `purge-expired-pins` rollout notes

Created 2026-08-22, held paused until the route was deployed (POS deploys on
push, and the first fire would otherwise have hit a 404 the next morning), then
resumed once live. Verified end-to-end before arming by calling the route with
the real `CRON_SECRET` but **without** `?write=1` — HTTP 200,
`{"ok":true,"write":false,"total":419,"candidates":4,"deleted":0}`, which proves
auth, the Admin SDK and the query all work while deleting nothing.

Useful commands (note the `--location`, it is not the default region):

```bash
# force a run instead of waiting for Sunday — NOTE: the job URI carries
# ?write=1, so this really deletes
gcloud scheduler jobs run purge-expired-pins   --location=asia-southeast1 --project=shareat-hub-v2

# report-only check, deletes nothing
curl -H "Authorization: Bearer $CRON_SECRET"   https://app.shareat.net/api/cron/purge-expired-pins

gcloud scheduler jobs pause  purge-expired-pins --location=asia-southeast1 --project=shareat-hub-v2
gcloud scheduler jobs resume purge-expired-pins --location=asia-southeast1 --project=shareat-hub-v2
```

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
REGION=asia-southeast1   # where 6 of the 7 live; rebuild-presets is in asia-east1

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

# NOTE the ?write=1 — without it this route only reports and deletes nothing.
gcloud scheduler jobs create http purge-expired-pins \
  --location="$REGION" \
  --schedule="0 3 * * 0" \
  --time-zone="Asia/Manila" \
  --uri="$BACKEND_URL/api/cron/purge-expired-pins?write=1" \
  --http-method=GET \
  --headers="Authorization=Bearer $CRON_SECRET" \
  --attempt-deadline=300s
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
