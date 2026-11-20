import { describe, it, expect, beforeEach, vi } from "vitest";

let ads: Array<Record<string, any>>;

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => ({
    collection: (path: string) => ({
      where: (field: string, _op: string, value: unknown) => ({
        get: async () => ({
          docs: (path === "tvAds" ? ads : [])
            .filter((a) => a[field] === value)
            .map((a) => ({ id: a.id, data: () => a })),
        }),
      }),
    }),
  }),
}));

import { GET } from "./route";

const get = (qs: string, key: string | null = "tv-key") =>
  new Request(`http://localhost/api/external/tv-ads?${qs}`, {
    headers: key ? { "x-api-key": key } : {},
  });

const ad = (id: string, over: Record<string, any> = {}) => ({
  id, url: `https://x/${id}`, type: "image", bytes: 100, durationSec: null,
  storeIds: "all", active: true, createdAt: 1, ...over,
});

beforeEach(() => {
  process.env.POS_EXTERNAL_API_KEY = "global-key";
  process.env.POS_EXTERNAL_API_KEYS_JSON = JSON.stringify({ "tv-key": ["lipa", "malvar"] });
  ads = [];
});

describe("GET /api/external/tv-ads", () => {
  it("401 without a key", async () => {
    expect((await GET(get("storeId=lipa", null))).status).toBe(401);
  });

  it("400 without storeId", async () => {
    expect((await GET(get(""))).status).toBe(400);
  });

  it("403 for a store outside the key's scope", async () => {
    expect((await GET(get("storeId=sto"))).status).toBe(403);
  });

  it("returns only active ads for the store or all, newest first, max 30", async () => {
    ads = [
      ad("old", { createdAt: 1 }),
      ad("new", { createdAt: 3, type: "video", durationSec: 42 }),
      ad("malvarOnly", { createdAt: 5, storeIds: ["malvar"] }),
      ad("lipaGif", { createdAt: 2, type: "gif", storeIds: ["lipa"] }),
      ad("off", { createdAt: 9, active: false }),
    ];
    for (let i = 0; i < 40; i++) ads.push(ad(`bulk${i}`, { createdAt: 0 }));
    const body = await (await GET(get("storeId=lipa"))).json();
    expect(body.storeId).toBe("lipa");
    expect(body.ads.slice(0, 3)).toEqual([
      { id: "new", type: "video", url: "https://x/new", bytes: 100, seconds: 42 },
      { id: "lipaGif", type: "gif", url: "https://x/lipaGif", bytes: 100, seconds: 10 },
      { id: "old", type: "image", url: "https://x/old", bytes: 100, seconds: 10 },
    ]);
    expect(body.ads).toHaveLength(30);
    expect(body.ads.map((a: any) => a.id)).not.toContain("malvarOnly");
  });

  it("drops entries with an unknown type or no url", async () => {
    ads = [ad("ok"), ad("bad", { type: "pdf" }), ad("nourl", { url: "" })];
    const body = await (await GET(get("storeId=lipa"))).json();
    expect(body.ads.map((a: any) => a.id)).toEqual(["ok"]);
  });

  it("version is stable for the same list and changes when an ad is added", async () => {
    ads = [ad("a")];
    const v1 = (await (await GET(get("storeId=lipa"))).json()).version;
    const v2 = (await (await GET(get("storeId=lipa"))).json()).version;
    ads.push(ad("b", { createdAt: 2 }));
    const v3 = (await (await GET(get("storeId=lipa"))).json()).version;
    expect(v1).toBe(v2);
    expect(v3).not.toBe(v1);
  });
});
