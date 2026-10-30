/**
 * Records every `onSnapshot` subscription so tests can fire snapshots/errors
 * and count live listeners. Pair with a `vi.mock("firebase/firestore", …)`
 * whose `onSnapshot` delegates to `fake.onSnapshot`.
 */
export type FakeListener = {
  ref: any;
  next: (snap: any) => void;
  error?: (err: any) => void;
  active: boolean;
};

export function createFakeSnapshots() {
  const listeners: FakeListener[] = [];
  return {
    listeners,
    onSnapshot(ref: any, next: (snap: any) => void, error?: (err: any) => void) {
      const l: FakeListener = { ref, next, error, active: true };
      listeners.push(l);
      return () => {
        l.active = false;
      };
    },
    active() {
      return listeners.filter((l) => l.active);
    },
    reset() {
      listeners.length = 0;
    },
  };
}

/** A query snapshot with `docs` built from `{ id, ...data }` rows. */
export function querySnap(rows: Array<{ id: string } & Record<string, any>>) {
  return {
    size: rows.length,
    metadata: { fromCache: false },
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
  };
}

/** A document snapshot. `data` undefined = the doc does not exist. */
export function docSnap(id: string, data?: Record<string, any>) {
  return { id, exists: () => data !== undefined, data: () => data };
}
