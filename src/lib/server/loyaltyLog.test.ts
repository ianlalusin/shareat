import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
    arrayUnion: (...v: any[]) => ({ __union: v }),
    increment: (n: number) => ({ __inc: n }),
  },
}));

const harness: { db: any; sets: Array<{ path: string; data: any }> } = { db: null, sets: [] };

vi.mock("@/lib/firebase/admin", () => ({
  getAdminDb: () => harness.db,
}));

import { appendLogToProjection } from "./loyaltyLog";

beforeEach(() => {
  harness.sets = [];
  harness.db = {
    doc: (path: string) => ({ path }),
    collection: () => ({ doc: () => ({ id: "x" }) }),
    runTransaction: async (fn: (tx: any) => Promise<any>) =>
      fn({
        get: async () => ({ exists: false, data: () => undefined }),
        set: (r: any, data: any) => harness.sets.push({ path: r.path, data }),
      }),
  };
});

function appendedEntry() {
  const part = harness.sets.find((s) => /_0$/.test(s.path));
  return part!.data.entries.__union[0];
}

const base = {
  type: "points_earned" as const,
  phone: "09171234567",
  customerName: "Ana",
  actorUid: "staff1",
  storeId: "storeA",
  sessionId: "s1",
};

describe("appendLogToProjection viaCashierLink", () => {
  it("stamps viaCashierLink: true on the projection entry when set", async () => {
    await appendLogToProjection({ ...base, viaCashierLink: true }, "log1");
    expect(appendedEntry()).toMatchObject({ logId: "log1", type: "points_earned", viaCashierLink: true });
  });

  it("leaves the entry shape unchanged when not cashier-linked", async () => {
    await appendLogToProjection(base, "log2");
    expect(appendedEntry()).not.toHaveProperty("viaCashierLink");
  });
});
