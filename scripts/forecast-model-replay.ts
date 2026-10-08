// scripts/forecast-model-replay.ts
// READ-ONLY. Usage: node --env-file=.env.local node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/forecast-model-replay.ts
// Note: holidayEffects lifts were computed from all history, so holiday days carry slight lookahead.
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { emptyModel, forecastDay, learnDay } from "@/lib/forecast/model";
import { buildDayContext, toDayId, type ContextSources } from "@/lib/forecast/context";
import { addDaysYmd, effectivePaydays, paydayDaysOfMonth } from "@/lib/forecast/payday";
import type { ForecastConfig } from "@/lib/types";

const sa = JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_SA_PATH!, "utf8"));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: String(sa.private_key).replace(/\n/g, "\n") }) });
const db = getFirestore();
const ymd = (id: string) => `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
type Sums = { abs: number; act: number; sig: number; n: number };
const z = (): Sums => ({ abs: 0, act: 0, sig: 0, n: 0 });
const add = (s: Sums, p: number, a: number) => { s.abs += Math.abs(p - a); s.act += a; s.sig += p - a; s.n++; };
const fmt = (s: Sums) => s.act ? `${(100 * s.abs / s.act).toFixed(1)}% (bias ${(100 * s.sig / s.act).toFixed(1)}%)` : "n/a";

(async () => {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const all = { model: z(), llm: z(), avg4: z() };
  for (const store of (await db.collection("stores").get()).docs) {
    const sid = store.id;
    const [an, fc, cal, wf, dc, eff] = await Promise.all([
      db.collection(`stores/${sid}/analytics`).get(),
      db.collection(`stores/${sid}/salesForecasts`).get(),
      db.collection(`stores/${sid}/holidayCalendar`).get(),
      db.collection(`stores/${sid}/weatherForecasts`).get(),
      db.collection(`stores/${sid}/dailyContext`).get(),
      db.doc(`stores/${sid}/holidayEffects/summary`).get(),
    ]);
    if (fc.empty || an.empty) continue;
    const sales = new Map<string, number>();
    an.docs.forEach((d) => { if (/^\d{8}$/.test(d.id)) sales.set(ymd(d.id), d.data()?.payments?.totalGross ?? 0); });
    const llm = new Map<string, number>();
    fc.docs.forEach((d) => {
      const x = d.data();
      const v = typeof x.llmSales === "number" ? x.llmSales : x.engine === "model" ? null : x.projectedSales;
      if (typeof v === "number") llm.set(x.date ?? d.id, v);
    });
    const dates = [...sales.keys()].sort();
    const first = dates[0];
    const src: ContextSources = {
      calendarNames: {}, holidayOverrides: {}, staffPaydays: new Set(),
      effects: (eff.data()?.effects ?? {}) as ContextSources["effects"], paydays: [], weather: {},
    };
    cal.docs.forEach((d) => Object.entries((d.data()?.days ?? {}) as Record<string, { name: string }>).forEach(([id, e]) => (src.calendarNames[id] = e.name)));
    wf.docs.forEach((d) => Object.assign(src.weather, d.data()?.days ?? {}));
    dc.docs.forEach((d) => {
      const x = d.data(); const id = x.dayId ?? d.id;
      if (typeof x.holiday?.name === "string") src.holidayOverrides[id] = x.holiday.name;
      if (x.isPayday?.value === true) src.staffPaydays.add(id);
    });
    const dom = paydayDaysOfMonth(store.data().forecastConfig as ForecastConfig | undefined);
    src.paydays = dom ? effectivePaydays(dom, first, today) : [];

    let model = emptyModel(sid);
    const st = { model: z(), llm: z(), avg4: z() };
    for (let d = first; d < today; d = addDaysYmd(d, 1)) {
      const actual = sales.get(d) ?? 0;
      const f = forecastDay(model, buildDayContext(d, src, "forecast"));
      const prior = [7, 14, 21, 28].map((k) => sales.get(addDaysYmd(d, -k)) ?? 0).filter((v) => v > 0);
      const p = llm.get(d);
      if (f && actual > 0 && typeof p === "number" && prior.length === 4) {
        const avg4 = prior.reduce((a, b) => a + b, 0) / 4;
        for (const [k, v] of [["model", f.sales], ["llm", p], ["avg4", avg4]] as const) { add(st[k], v, actual); add(all[k], v, actual); }
      }
      model = learnDay(model, buildDayContext(d, src, "learn"), actual);
    }
    if (st.model.n) console.log(`${store.data().name ?? sid} n=${st.model.n} | model ${fmt(st.model)} | llm ${fmt(st.llm)} | avg4 ${fmt(st.avg4)}`);
  }
  console.log(`ALL n=${all.model.n} | model ${fmt(all.model)} | llm ${fmt(all.llm)} | avg4 ${fmt(all.avg4)}`);
})().catch((e) => { console.error(e); process.exit(1); });
