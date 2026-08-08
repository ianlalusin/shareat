# Native (React Native) Rewrite of SharEat POS/ERP — Design

**Date:** 2026-06-11
**Status:** Approved (design); implementation plan to follow
**Repo:** `C:\Users\ianla\webapps\POS` (`shareat-v2` / CulinaryFlow)

## 1. Goal

Replace the current Capacitor-wrapped web build with a **genuinely native** mobile app
(native UI, not a webview) for **both Android and iOS**, at **full feature parity** with the
existing POS + Kitchen Display (KDS) + ERP web app.

## 2. Locked decisions

| Fork | Decision | Rationale |
|---|---|---|
| Tech stack | **React Native + TypeScript** (one codebase, native UI) | Reuses existing TS/React skills and business logic; renders native views, not a webview |
| Scope | **Full parity** — all roles (admin, manager, cashier, server, kitchen, account) | One native product everywhere |
| Backend | **Keep Firebase** — native SDK direct + existing API routes over HTTPS | App is already client-Firestore-first; backend barely changes |
| Tooling | **Expo (managed + dev-client) + EAS Build** | Dev machine is **Windows**; EAS Build compiles iOS in the cloud (no Mac needed). Config plugins support `@react-native-firebase` + native printer modules |
| UI layer | **NativeWind + react-native-reusables** | Team already uses Tailwind + ShadCN; tokens and primitives translate near 1:1 |
| Navigation | **Expo Router** (file-based) | Mirrors existing Next.js `app/` routing structure |

## 3. Why the existing app ports well

Findings from the codebase that make this tractable:

- **Client-Firestore-first:** 194 `onSnapshot` realtime listeners, only **2** `'use server'`
  actions (both AI flows). The data layer already lives client-side using the Firestore SDK.
- **No SSR dependency:** the app already produces a static export for Capacitor, so nothing
  relies on Next server rendering.
- **Clean backend contract:** 36 HTTPS API routes encapsulate the privileged operations
  (loyalty, pins, admin, AI, cron, external).

### LOC reuse map (~68K total)

| Layer | LOC | Verdict |
|---|---|---|
| `src/lib` (formatters, calc, collections, utils) | ~9,200 | Reuse ~85% as plain TS |
| `src/hooks` | ~2,560 | Reuse ~80% (swap DOM-only bits) |
| `src/context` (auth/store/local-profile) | ~420 | Reuse ~90% |
| `src/app/api` (36 routes) | (part of 14,847) | Keep as-is (backend) |
| `src/app` pages | (rest of 14,847) | Re-author as RN screens (logic translates) |
| `src/components` (40 ShadCN/Radix + features) | ~38,770 | Rebuild in RN (largest effort) |

Roughly: **~12K portable logic**, **~15K backend kept**, **~39K UI rebuilt** (translation, not blank page).

## 4. Target architecture

```
React Native app (Expo)
  Navigation: Expo Router (mirrors Next app/ structure)
  UI:         NativeWind (Tailwind for RN) + react-native-reusables (ShadCN-for-RN)
  State/data: existing React Context + hooks, ported
  Data:       @react-native-firebase (Firestore listeners + offline persistence)
  Native:     thermal printing · push · file export · maps · biometrics
     │ direct SDK (reads/writes/listeners)        │ HTTPS (privileged ops)
     ▼                                            ▼
  Firebase (Firestore / Auth / Storage)     Existing Next.js API routes
   — unchanged                               — unchanged
```

## 5. Reuse vs. rebuild by subsystem

**Ports cleanly (plain TS / React):** money/accounting math, discount/tip logic
(`lib/cashier/tips`, `lib/cash/handover`), Zod validation, collection helpers, day-id/PIN-day
logic, receipt/sales-report ESC/POS **formatters** (pure byte generation), Firestore queries
and all 194 listeners (same modular `onSnapshot` API), contexts, most hooks.

**Rebuilt natively (the real engineering):**

| Subsystem | Today | Native replacement |
|---|---|---|
| Thermal printing | `webusbPrinter.ts` (WebUSB, browser-only) | Native BLE/USB/LAN ESC/POS transport (`react-native-ble-plx` / TCP / thermal lib). **Formatters reused; only transport rewritten.** |
| Offline | static bundle + `payment-queue.ts` | Firestore native offline persistence + keep queue pattern for payments/prints |
| Auth gates | Firebase Auth + bcrypt PIN API + local sign-in gates | `@react-native-firebase/auth` + same PIN API; add biometric unlock for staff switching |
| Maps | `@vis.gl/react-google-maps` | `react-native-maps` |
| Excel/QR export | `xlsx`, `qrcode` (DOM/Blob) | RN filesystem + share sheet; RN QR lib |
| Push | `@capacitor/local-notifications` | FCM + Expo Notifications (real push, KDS alerts) |
| 40 ShadCN/Radix UI | DOM | NativeWind + react-native-reusables |
| Charts (`recharts`) | SVG/DOM | `victory-native` / RN charts |

**Stays put (backend, zero/low change):** all 36 API routes, the 2 Genkit AI flows, cron jobs,
Firestore rules, Storage rules.

## 6. Project structure (monorepo)

```
/apps/mobile        → React Native (Expo) app
/apps/web           → existing Next.js app (backend/API + optional web access)
/packages/core      → shared TS: types, Zod schemas, money/accounting/format logic, query builders
/packages/printing  → shared ESC/POS formatters (transport injected per-platform)
```

Extract the portable `src/lib` into `packages/core` + `packages/printing` **first**, made
platform-agnostic (no `window`/DOM). Web and mobile both consume them → one source of truth for
business rules. *(Alternative: standalone mobile repo importing `core` as a published package —
simpler tooling, no live shared editing. Monorepo preferred.)*

## 7. Phased roadmap

- **Phase 0 — Foundations / de-risk:** Expo app + EAS Build (prove iOS-from-Windows); wire
  `@react-native-firebase` auth + one realtime Firestore screen; **prototype thermal printing to a
  real printer** (the #1 risk — prove before committing).
- **Phase 1 — Shared core:** extract `packages/core` + `packages/printing`; point the web app at
  them too (keeps web working, validates extraction).
- **Phase 2 — Cashier/POS:** sessions, bills, discounts, payments, **offline queue**, **receipt
  printing**. Make-or-break surface.
- **Phase 3 — Kitchen (KDS) + Server + Refill:** realtime tickets, push alerts, bump flow.
- **Phase 4 — Manager + reports:** store settings, inventory, collections, sales-report printing, charts.
- **Phase 5 — Admin/ERP:** users, menu/products, loyalty, insights, data tools.
- **Phase 6 — Hardening & launch:** offline soak tests, device/printer matrix, app-store submission,
  pilot one store, then roll out.

## 8. Top risks & mitigations

1. **Thermal printing** across BLE/USB/LAN device variety → prove in Phase 0; standardize on
   supported printer models.
2. **UI rebuild volume (~39K LOC)** → NativeWind + reusables to translate rather than redesign;
   share all logic via `packages/core`.
3. **Offline correctness for payments** → keep queue pattern + Firestore native persistence; soak-test.
4. **Web + mobile in parallel during migration** → safe; backend shared and unchanged, rules already
   enforce access.

## 9. Effort

Full parity of a 68K-LOC product is multi-month. With heavy logic reuse and translate-not-redesign
UI: Phase 0–2 yields a usable in-store POS; Phases 3–5 are incremental. Concrete per-phase sizing
lives in the implementation plan.

## 10. Next step

Produce the detailed implementation plan, starting with Phase 0 broken into concrete buildable tasks.
