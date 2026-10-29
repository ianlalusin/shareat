import { describe, it, expect, beforeEach, vi } from "vitest";

let docs: Record<string, any>;
let sessions: any[];
let lastStatusFilter: unknown;

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    doc: (path: string) => ({
      get: async () => ({ exists: path in docs, data: () => docs[path] }),
    }),
    collection: (path: string) => ({
      where: (_f: string, _op: string, value: unknown) => {
        lastStatusFilter = value;
        return {
          get: async () => ({
            size: path === "stores/lipa/sessions" ? sessions.length : 0,
            docs: (path === "stores/lipa/sessions" ? sessions : []).map((d) => ({ data: () => d })),
          }),
        };
      },
    }),
  }),
}));

import { GET } from "./route";

const get = (qs: string, key: string | null = "tv-key") =>
  new Request(`http://localhost/api/external/live-summary?${qs}`, {
    headers: key ? { "x-api-key": key } : {},
  });

beforeEach(() => {
  process.env.POS_EXTERNAL_API_KEY = "global-key";
  process.env.POS_EXTERNAL_API_KEYS_JSON = JSON.stringify({ "tv-key": ["lipa", "malvar"] });
  // 2026-10-29 14:30 Manila = 06:30 UTC; last week = 2026-10-22.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T06:30:00Z"));
  docs = {};
  sessions = [];
  lastStatusFilter = undefined;
});

describe("GET /api/external/live-summary", () => {
  it("401 without a key", async () => {
    expect((await GET(get("storeId=lipa", null))).status).toBe(401);
  });

  it("400 without storeId", async () => {
    expect((await GET(get(""))).status).toBe(400);
  });

  it("403 for a store outside the key's scope", async () => {
    expect((await GET(get("storeId=sto"))).status).toBe(403);
  });

  it("returns today's totals, active sessions and last-week comparison through this hour", async () => {
    docs["stores/lipa/analytics/20261029"] = {
      payments: { totalGross: 25000, txCount: 18 },
      guests: { guestCountFinalTotal: 52 },
      sales: { salesAmountByHour: { "11": 9000, "12": 10000, "14": 6000, "15": 999 } },
    };
    docs["stores/lipa/analytics/20261022"] = {
      sales: { salesAmountByHour: { "11": 8000, "13": 12000, "16": 5000 } },
    };
    sessions = [{ guestCountFinal: 4 }, { guestCountServerVerified: 3 }, { guestCountCashierInitial: 2 }, {}];

    const res = await GET(get("storeId=lipa"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      storeId: "lipa",
      dayId: "20261029",
      todaySales: 25000,
      closedSessions: 18,
      guestsServed: 52,
      activeSessions: 4,
      activeGuests: 9,
      todaySalesByThisHour: 25000,
      lastWeekSalesByThisHour: 20000,
    });
    expect(lastStatusFilter).toEqual(["active", "pending_verification"]);
  });

  it("zeros when the day has no analytics yet", async () => {
    const body = await (await GET(get("storeId=malvar"))).json();
    expect(body).toMatchObject({ todaySales: 0, closedSessions: 0, guestsServed: 0, activeSessions: 0, lastWeekSalesByThisHour: 0 });
  });

  it("the global key may read any store", async () => {
    expect((await GET(get("storeId=sto", "global-key"))).status).toBe(200);
  });
});
