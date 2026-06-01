# Scheduled Jobs

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
| `log-weather`              | `GET /api/cron/log-weather`         | `0 * * * *` (hourly)            | 120s             |

`log-weather` polls OpenWeatherMap once per active store (geotagged via the store
editor) and upserts each day's forecast into the monthly doc
`stores/<storeId>/weatherForecasts/<YYYY-MM>`. The sales forecast reads those docs
— it never calls the weather API itself, keeping usage well under the free tier.
Stores without a geotag are skipped.

`generate-forecast` fires up to five times because the route self-deduplicates
via `system/forecastCronLog.runs[<date>]` — the first successful run marks the
day "success" and later attempts short-circuit. The extra fires only exist as
fallbacks for transient Gemini or Firestore failures.

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
```

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
