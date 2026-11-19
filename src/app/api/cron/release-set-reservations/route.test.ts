import { describe, it, expect, vi, beforeEach } from "vitest";

const release = vi.fn(async (_db: unknown, _storeId: string, _nowMs: number) => ({ released: 1, skipped: 0 }));

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => ({}) }));
vi.mock("@/lib/server/active-stores-cache", () => ({ getActiveStores: async () => [{ id: "S1" }, { id: "S2" }] }));
vi.mock("@/lib/server/release-set-reservations", () => ({
  releaseSetReservationsForStore: (...a: [unknown, string, number]) => release(...a),
}));

import { GET } from "./route";

const call = (auth?: string) =>
  GET(new Request("http://localhost/api/cron/release-set-reservations", { headers: auth ? { authorization: auth } : {} }));

describe("GET /api/cron/release-set-reservations", () => {
  beforeEach(() => {
    release.mockClear();
    process.env.CRON_SECRET = "s3cret";
  });

  it("401s without the bearer secret and releases nothing", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(release).not.toHaveBeenCalled();
  });

  it("500s when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer undefined")).status).toBe(500);
  });

  it("releases every active store and totals the result", async () => {
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    expect(release).toHaveBeenCalledTimes(2);
    await expect(res.json()).resolves.toMatchObject({ ok: true, released: 2, skipped: 0 });
  });
});
