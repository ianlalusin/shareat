import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => ({ __sentinel: "serverTimestamp" }) },
}));

import { endAllParticipants } from "./customer-participants";

/**
 * Minimal fake covering only what customer-participants.ts calls:
 * db.collection(path).where("status","==","active").get(), db.doc(path),
 * db.batch().update()/.commit().
 */
function makeFakeDb(
  activeDocs: Array<{ id: string; claimedByUid?: string | null }>,
  { sessionExists = true }: { sessionExists?: boolean } = {},
) {
  const batchUpdates: Array<{ refId: string; data: any }> = [];
  let committed = false;

  const batch = {
    update: vi.fn((ref: { id: string }, data: any) => {
      batchUpdates.push({ refId: ref.id, data });
    }),
    commit: vi.fn(async () => {
      committed = true;
    }),
  };

  const db = {
    collection: (path: string) => {
      expect(path).toBe("stores/store1/activeSessions/session1/customerParticipants");
      return {
        where: (field: string, op: string, value: unknown) => {
          expect([field, op, value]).toEqual(["status", "==", "active"]);
          return {
            get: async () => {
              const docs = activeDocs.map((d) => ({
                ref: { id: d.id },
                data: () => ({ status: "active", claimedByUid: d.claimedByUid ?? null }),
              }));
              return { empty: docs.length === 0, size: docs.length, docs };
            },
          };
        },
      };
    },
    doc: (path: string) => ({ id: path, get: async () => ({ exists: sessionExists }) }),
    batch: () => batch,
  };

  return { db: db as any, batch, batchUpdates, isCommitted: () => committed };
}

type AuthBehavior = "ok" | { code: string; message?: string } | Error;

function makeFakeAuth(behaviors: Record<string, AuthBehavior> = {}) {
  const deleteUser = vi.fn(async (uid: string) => {
    const behavior = behaviors[uid] ?? "ok";
    if (behavior === "ok") return;
    if (behavior instanceof Error) throw behavior;
    const err: any = new Error(behavior.message ?? behavior.code);
    err.code = behavior.code;
    throw err;
  });
  return { auth: { deleteUser } as any, deleteUser };
}

describe("endAllParticipants", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("deletes each distinct cust_ uid exactly once", async () => {
    const { db } = makeFakeDb([
      { id: "p1", claimedByUid: "cust_aaa" },
      { id: "p2", claimedByUid: "cust_bbb" },
      // A second participant re-using the same device/uid must not double-delete.
      { id: "p3", claimedByUid: "cust_aaa" },
    ]);
    const { auth, deleteUser } = makeFakeAuth();

    const result = await endAllParticipants(db, auth, "store1", "session1", "ended", "staff1", "finalize_manual_disable");

    expect(result).toEqual({ revoked: 3, authDeleted: 2 });
    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenCalledWith("cust_aaa");
    expect(deleteUser).toHaveBeenCalledWith("cust_bbb");
  });

  it("skips a claimedByUid that does not start with cust_ (defensive guard)", async () => {
    const { db } = makeFakeDb([
      { id: "p1", claimedByUid: "cust_aaa" },
      { id: "p2", claimedByUid: "staff_mistakenly_set" },
      { id: "p3", claimedByUid: null },
    ]);
    const { auth, deleteUser } = makeFakeAuth();

    const result = await endAllParticipants(db, auth, "store1", "session1", "revoked", "staff1", "pin_reissued");

    expect(result).toEqual({ revoked: 3, authDeleted: 1 });
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("cust_aaa");
  });

  it("treats an auth/user-not-found rejection as success and still resolves", async () => {
    const { db } = makeFakeDb([{ id: "p1", claimedByUid: "cust_gone" }]);
    const { auth } = makeFakeAuth({ cust_gone: { code: "auth/user-not-found" } });

    const result = await endAllParticipants(db, auth, "store1", "session1", "ended", "staff1", "manual_reset");

    expect(result).toEqual({ revoked: 1, authDeleted: 1 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logs a warning for any other rejection but still resolves with the revoked count intact", async () => {
    const { db } = makeFakeDb([
      { id: "p1", claimedByUid: "cust_ok" },
      { id: "p2", claimedByUid: "cust_broken" },
    ]);
    const { auth } = makeFakeAuth({
      cust_broken: { code: "auth/internal-error", message: "boom" },
    });

    const result = await endAllParticipants(db, auth, "store1", "session1", "revoked", "staff1", "manual_reset");

    expect(result).toEqual({ revoked: 2, authDeleted: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      "[customer-participants] auth user delete failed",
      "cust_broken",
      "boom"
    );
  });

  it("never throws even when every deletion rejects", async () => {
    const { db } = makeFakeDb([{ id: "p1", claimedByUid: "cust_broken" }]);
    const { auth } = makeFakeAuth({ cust_broken: new Error("network down") });

    await expect(
      endAllParticipants(db, auth, "store1", "session1", "ended", "staff1", "finalize_manual_disable")
    ).resolves.toEqual({ revoked: 1, authDeleted: 0 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("deletes nothing and does not touch auth when there are no active participants", async () => {
    const { db, isCommitted } = makeFakeDb([]);
    const { auth, deleteUser } = makeFakeAuth();

    const result = await endAllParticipants(db, auth, "store1", "session1", "ended", "staff1", "finalize_manual_disable");

    expect(result).toEqual({ revoked: 0, authDeleted: 0 });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(isCommitted()).toBe(false);
  });

  it("still ends participants when the session doc is already gone (bill paid)", async () => {
    const { db, batchUpdates, isCommitted } = makeFakeDb(
      [{ id: "p1", claimedByUid: "cust_a" }],
      { sessionExists: false },
    );
    const { auth } = makeFakeAuth();

    const result = await endAllParticipants(db, auth, "store1", "session1", "ended", "staff1", "payment_closed");

    expect(isCommitted()).toBe(true);
    expect(batchUpdates.map((u) => u.refId)).toEqual(["p1"]);
    expect(result).toEqual({ revoked: 1, authDeleted: 1 });
  });

  it("resets the session's active-participant count when the session still exists", async () => {
    const { db, batchUpdates } = makeFakeDb([{ id: "p1", claimedByUid: "cust_a" }]);
    await endAllParticipants(db, makeFakeAuth().auth, "store1", "session1", "ended", "staff1", "payment_closed");
    expect(batchUpdates.find((u) => u.refId === "stores/store1/activeSessions/session1")?.data)
      .toEqual({ customerParticipantActiveCount: 0 });
  });
});
