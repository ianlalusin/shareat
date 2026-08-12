import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

/**
 * Route-level tests for /api/product-photo-requests, focused on the auth
 * matrix (this session's audit found admin routes need explicit per-op
 * role/store-scope tests, not just a happy path) and the
 * reject-only-clears-if-still-current guard.
 */

const MANAGER_UID = "mgr_1";
const ADMIN_UID = "admin_1";
const CASHIER_UID = "cashier_1";
const STORE_A = "storeA";
const STORE_B = "storeB";
const PRODUCT = "prod_1";
const IMAGE_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/productPhotos%2Fprod_1%2FstoreA.webp";

// --- module mocks ------------------------------------------------------

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => ({ __sentinel: "serverTimestamp" }),
  },
}));

let mockCallerUid = MANAGER_UID;

vi.mock("@/lib/firebase/admin", () => ({
  getAdminAuth: () => ({
    verifyIdToken: async () => ({ uid: mockCallerUid, name: "Caller", email: "caller@example.com" }),
  }),
  getAdminDb: () => harness.db,
}));

/**
 * The role the mocked caller actually holds.
 *
 * The auth helpers are mocked, but they must still HONOUR the `allowedRoles`
 * list the route hands them. An earlier version of this file ignored that
 * argument and threw unconditionally, so "a manager is denied on promote"
 * passed even if the route had passed `["admin","manager"]` — the test proved
 * nothing about the role matrix it exists to pin down.
 */
let callerRole: "manager" | "admin" | "cashier" = "manager";

/** The exact allowedRoles array the route last handed each helper. */
let lastStoreAccessRoles: string[] | undefined;
let lastActiveStaffRoles: string[] | undefined;

let mockStoreAccessImpl: (storeId: string, allowedRoles: string[]) => Promise<{
  uid: string; role: string; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;
let mockActiveStaffImpl: (allowedRoles: string[]) => Promise<{
  uid: string; role: string; displayName: string | null; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;

vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _decoded: any, storeId: string, allowedRoles: string[]) => {
    lastStoreAccessRoles = allowedRoles;
    return mockStoreAccessImpl(storeId, allowedRoles);
  },
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async (_db: any, _decoded: any, allowedRoles: string[]) => {
    lastActiveStaffRoles = allowedRoles;
    return mockActiveStaffImpl(allowedRoles);
  },
}));

import { POST } from "./route";

// --- in-memory firestore double -----------------------------------------

function makeHarness(docs: Record<string, any>) {
  const makeRef = (path: string) => ({
    path,
    id: path.split("/").pop() as string,
    get: async () => ({ exists: docs[path] !== undefined, data: () => docs[path] }),
  });

  const db = {
    doc: (path: string) => makeRef(path),
    collection: (path: string) => ({ doc: (id: string) => makeRef(`${path}/${id}`) }),
    batch: () => ({
      set: (ref: any, data: any) => {
        docs[ref.path] = { ...(docs[ref.path] || {}), ...data };
      },
      update: (ref: any, data: any) => {
        docs[ref.path] = { ...(docs[ref.path] || {}), ...data };
      },
      delete: (ref: any) => {
        delete docs[ref.path];
      },
      commit: async () => {},
    }),
  };

  return { db, docs };
}

let harness: ReturnType<typeof makeHarness>;

function req(body: any) {
  return new Request("http://localhost/api/product-photo-requests", {
    method: "POST",
    headers: { Authorization: "Bearer faketoken", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  callerRole = "manager";
  mockCallerUid = MANAGER_UID;
  lastStoreAccessRoles = undefined;
  lastActiveStaffRoles = undefined;

  // Faithful stand-ins for the real helpers: reject when the caller's role
  // isn't in the list the route asked for, and only then apply the
  // store-scope check. Denials therefore depend on what the route passes.
  mockStoreAccessImpl = async (storeId: string, allowedRoles: string[]) => {
    if (!allowedRoles?.includes(callerRole)) throw new Error("You are not allowed to access this route.");
    if (storeId !== STORE_A) throw new Error("No access to this store.");
    return { uid: mockCallerUid, role: callerRole, assignedStoreIds: [STORE_A], isPlatformAdmin: callerRole === "admin" };
  };
  mockActiveStaffImpl = async (allowedRoles: string[]) => {
    if (!allowedRoles?.includes(callerRole)) throw new Error("You are not allowed to access this route.");
    return {
      uid: mockCallerUid,
      role: callerRole,
      displayName: callerRole === "admin" ? "Ana Admin" : "Manny Manager",
      assignedStoreIds: [STORE_A],
      isPlatformAdmin: callerRole === "admin",
    };
  };
  harness = makeHarness({
    [`products/${PRODUCT}`]: { name: "Coke", imageUrl: null },
    [`stores/${STORE_A}`]: { name: "Shareat Lipa" },
    [`stores/${STORE_A}/inventory/${PRODUCT}`]: { name: "Coke", imageUrl: null },
  });
});

describe("submit", () => {
  it("allows a manager to submit a photo for their own store", async () => {
    const res = await POST(req({ op: "submit", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBe(IMAGE_URL);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("pending");
    // Store-scoped check, and open to exactly admin + manager — never wider.
    expect(lastStoreAccessRoles).toEqual(["admin", "manager"]);
    expect(lastActiveStaffRoles).toBeUndefined(); // never the unscoped helper
  });

  it("denies a manager submitting for a store they aren't assigned to", async () => {
    const res = await POST(req({ op: "submit", storeId: STORE_B, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(403);
  });

  it("denies a cashier submitting for their own store", async () => {
    // Nothing below manager may attach a photo to the menu: it goes live at
    // the store immediately and is a candidate for every store's default.
    callerRole = "cashier";
    mockCallerUid = CASHIER_UID;
    const res = await POST(req({ op: "submit", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(403);
    expect(lastStoreAccessRoles).toEqual(["admin", "manager"]);
    // The write must not have happened.
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`]).toBeUndefined();
  });

  it("rejects an image URL that isn't from our Storage bucket", async () => {
    const res = await POST(
      req({ op: "submit", storeId: STORE_A, productId: PRODUCT, imageUrl: "https://evil.example.com/x.webp" })
    );
    expect(res.status).toBe(400);
  });
});

describe("remove", () => {
  it("clears the store's local imageUrl and deletes the request", async () => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = { status: "pending" };
    const res = await POST(req({ op: "remove", storeId: STORE_A, productId: PRODUCT }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`]).toBeUndefined();
    expect(lastStoreAccessRoles).toEqual(["admin", "manager"]);
    expect(lastActiveStaffRoles).toBeUndefined();
  });

  it("denies a manager removing another store's photo", async () => {
    const res = await POST(req({ op: "remove", storeId: STORE_B, productId: PRODUCT }));
    expect(res.status).toBe(403);
  });
});

describe("promote — admin only", () => {
  beforeEach(() => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      id: `${STORE_A}_${PRODUCT}`,
      storeId: STORE_A,
      productId: PRODUCT,
      status: "pending",
      imageUrl: IMAGE_URL,
    };
  });

  it("denies a manager (even for their own store's request)", async () => {
    const res = await POST(req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(403);
    // The denial must come from the route asking for admin ONLY — not from a
    // mock that refuses everything.
    expect(lastActiveStaffRoles).toEqual(["admin"]);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("pending");
  });

  it("allows an admin, setting products/{id}.imageUrl from the STORED request, not the request body", async () => {
    callerRole = "admin";
    mockCallerUid = ADMIN_UID;
    const res = await POST(
      req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}`, imageUrl: "https://evil.example.com/spoofed.webp" })
    );
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBe(IMAGE_URL);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("approved");
    expect(lastActiveStaffRoles).toEqual(["admin"]);
    expect(lastStoreAccessRoles).toBeUndefined(); // never the store-scoped helper
  });

  it("refuses to promote a request that was already decided", async () => {
    callerRole = "admin";
    mockCallerUid = ADMIN_UID;
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status = "approved";
    const res = await POST(req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(409);
  });
});

describe("reject — admin only", () => {
  it("denies a manager", async () => {
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "pending", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(403);
    expect(lastActiveStaffRoles).toEqual(["admin"]);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("pending");
  });

  it("on a pending request, clears the store's local photo but never touches products/{id}.imageUrl", async () => {
    callerRole = "admin";
    mockCallerUid = ADMIN_UID;
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "pending", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = null;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBeNull();
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("rejected");
    expect(lastActiveStaffRoles).toEqual(["admin"]);
  });

  it("on an approved request whose photo is still the global one, clears products/{id}.imageUrl too", async () => {
    callerRole = "admin";
    mockCallerUid = ADMIN_UID;
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "approved", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = IMAGE_URL;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBeNull();
  });

  it("on an approved request whose photo was superseded by a different promotion, leaves products/{id}.imageUrl alone", async () => {
    callerRole = "admin";
    mockCallerUid = ADMIN_UID;
    const otherUrl = "https://firebasestorage.googleapis.com/v0/b/x/o/productPhotos%2Fprod_1%2FstoreB.webp";
    harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`] = {
      status: "approved", storeId: STORE_A, productId: PRODUCT, imageUrl: IMAGE_URL,
    };
    harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl = IMAGE_URL;
    harness.docs[`products/${PRODUCT}`].imageUrl = otherUrl;

    const res = await POST(req({ op: "reject", requestId: `${STORE_A}_${PRODUCT}` }));
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBe(otherUrl);
    expect(harness.docs[`stores/${STORE_A}/inventory/${PRODUCT}`].imageUrl).toBeNull();
  });
});
