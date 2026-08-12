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

let mockStoreAccessImpl: (storeId: string) => Promise<{
  uid: string; role: string; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;
let mockActiveStaffImpl: (allowedRoles: string[]) => Promise<{
  uid: string; role: string; displayName: string | null; assignedStoreIds: string[]; isPlatformAdmin: boolean;
}>;

vi.mock("@/lib/server/staff-access", () => ({
  requireStaffStoreAccess: async (_db: any, _decoded: any, storeId: string) => mockStoreAccessImpl(storeId),
}));

vi.mock("@/lib/server/active-staff-check", () => ({
  requireActiveStaff: async (_db: any, _decoded: any, allowedRoles: string[]) => mockActiveStaffImpl(allowedRoles),
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
  mockCallerUid = MANAGER_UID;
  mockStoreAccessImpl = async (storeId: string) => {
    if (storeId !== STORE_A) throw new Error("No access to this store.");
    return { uid: MANAGER_UID, role: "manager", assignedStoreIds: [STORE_A], isPlatformAdmin: false };
  };
  mockActiveStaffImpl = async () => {
    throw new Error("You are not allowed to access this route.");
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
  });

  it("denies a manager submitting for a store they aren't assigned to", async () => {
    const res = await POST(req({ op: "submit", storeId: STORE_B, productId: PRODUCT, imageUrl: IMAGE_URL }));
    expect(res.status).toBe(403);
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
  });

  it("allows an admin, setting products/{id}.imageUrl from the STORED request, not the request body", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
    const res = await POST(
      req({ op: "promote", requestId: `${STORE_A}_${PRODUCT}`, imageUrl: "https://evil.example.com/spoofed.webp" })
    );
    expect(res.status).toBe(200);
    expect(harness.docs[`products/${PRODUCT}`].imageUrl).toBe(IMAGE_URL);
    expect(harness.docs[`productPhotoRequests/${STORE_A}_${PRODUCT}`].status).toBe("approved");
  });

  it("refuses to promote a request that was already decided", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
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
  });

  it("on a pending request, clears the store's local photo but never touches products/{id}.imageUrl", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
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
  });

  it("on an approved request whose photo is still the global one, clears products/{id}.imageUrl too", async () => {
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
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
    mockActiveStaffImpl = async () => ({
      uid: ADMIN_UID, role: "admin", displayName: "Ana Admin", assignedStoreIds: [], isPlatformAdmin: true,
    });
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
