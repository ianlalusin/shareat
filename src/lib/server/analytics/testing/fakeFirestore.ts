/**
 * Minimal in-memory Firestore (Admin SDK shape) for analytics unit tests.
 * Supports what the receipt applier, reconcile sweep and daily rebuild use:
 * doc/collection/collectionGroup queries (where/orderBy/limit), getAll,
 * transactions (get/getAll/set/update/delete, buffered until commit), set
 * merge, FieldValue.increment/serverTimestamp/delete and per-doc updateTime.
 *
 * Wire it with:
 *   vi.mock("firebase-admin/firestore", async () => (await import("./testing/fakeFirestore")).firestoreModule);
 */

export class FakeTimestamp {
  constructor(public readonly ms: number) {}
  get seconds() { return Math.floor(this.ms / 1000); }
  get nanoseconds() { return (this.ms % 1000) * 1e6; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  isEqual(o: any) { return o instanceof FakeTimestamp && o.ms === this.ms; }
  static fromDate(d: Date) { return new FakeTimestamp(d.getTime()); }
  static fromMillis(ms: number) { return new FakeTimestamp(ms); }
  static now() { return new FakeTimestamp(Date.now()); }
}

type Sentinel = { __fv: "inc"; n: number } | { __fv: "ts" } | { __fv: "del" };
const isSentinel = (v: any): v is Sentinel => !!v && typeof v === "object" && "__fv" in v;

export const FieldValue = {
  increment: (n: number): Sentinel => ({ __fv: "inc", n }),
  serverTimestamp: (): Sentinel => ({ __fv: "ts" }),
  delete: (): Sentinel => ({ __fv: "del" }),
};

/** serverTimestamp resolves to this constant so states compare deterministically. */
export const SERVER_TS = "SERVER_TS";

export const FieldPath = { documentId: () => "__name__" };

export const firestoreModule = { FieldValue, Timestamp: FakeTimestamp, FieldPath };

const isPlainObject = (v: any) =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof FakeTimestamp) && !isSentinel(v);

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as any;
  if (isPlainObject(v)) {
    const o: any = {};
    for (const [k, x] of Object.entries(v as any)) o[k] = clone(x);
    return o;
  }
  return v;
}

function resolveValue(cur: any, v: any): any {
  if (isSentinel(v)) {
    if (v.__fv === "inc") return (typeof cur === "number" ? cur : 0) + v.n;
    if (v.__fv === "ts") return SERVER_TS;
  }
  if (isPlainObject(v)) {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) {
      if (isSentinel(x) && x.__fv === "del") continue;
      o[k] = resolveValue(undefined, x);
    }
    return o;
  }
  return clone(v);
}

function deepMerge(target: any, src: any): any {
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(src)) {
    if (isSentinel(v) && v.__fv === "del") delete out[k];
    else if (isPlainObject(v)) out[k] = deepMerge(out[k], v);
    else out[k] = resolveValue(out[k], v);
  }
  return out;
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function cmp(a: any, b: any): number {
  const n = (x: any) => (x instanceof FakeTimestamp ? x.ms : x);
  const x = n(a);
  const y = n(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

type Doc = { data: any; updateTime: FakeTimestamp };

export class FakeFirestore {
  docs = new Map<string, Doc>();
  private clock = 1_000;
  /** Called after a collection query on `path` is evaluated (test hook). */
  afterQuery: ((path: string) => Promise<void> | void) | null = null;

  doc(path: string) {
    const parts = path.split("/");
    return { path, id: parts[parts.length - 1], get: async () => this.snap(path) };
  }

  /** Raw data for assertions (undefined when missing). */
  data(path: string): any {
    return this.docs.get(path)?.data;
  }

  seed(path: string, data: any) {
    this.write(path, () => clone(data));
  }

  private write(path: string, fn: (cur: any) => any | undefined) {
    const next = fn(this.docs.get(path)?.data);
    if (next === undefined) this.docs.delete(path);
    else this.docs.set(path, { data: next, updateTime: new FakeTimestamp(++this.clock) });
  }

  private snap(path: string) {
    const d = this.docs.get(path);
    const ref = this.doc(path);
    return {
      id: ref.id,
      ref,
      exists: !!d,
      updateTime: d?.updateTime,
      data: () => (d ? clone(d.data) : undefined),
    };
  }

  async getAll(...refs: any[]) {
    return refs.map((r) => this.snap(r.path));
  }

  private query(match: (path: string) => boolean, collPath: string | null) {
    const filters: Array<[string, string, any]> = [];
    let order: string | null = null;
    let lim = Infinity;
    const self = this;
    const q: any = {
      where(f: string, op: string, v: any) { filters.push([f, op, v]); return q; },
      orderBy(f: string) { order = f; return q; },
      limit(n: number) { lim = n; return q; },
      async get() {
        let rows = [...self.docs.entries()].filter(([p]) => match(p));
        rows = rows.filter(([, d]) =>
          filters.every(([f, op, v]) => {
            const x = getPath(d.data, f);
            if (x === undefined) return false;
            const c = cmp(x, v);
            return op === "==" ? c === 0 : op === ">=" ? c >= 0 : op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : false;
          }),
        );
        if (order) rows.sort(([, a], [, b]) => cmp(getPath(a.data, order!), getPath(b.data, order!)));
        const docs = rows.slice(0, lim).map(([p]) => self.snap(p));
        if (collPath && self.afterQuery) await self.afterQuery(collPath);
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
    return q;
  }

  collection(path: string) {
    const depth = path.split("/").length + 1;
    return this.query((p) => p.startsWith(path + "/") && p.split("/").length === depth, path);
  }

  collectionGroup(name: string) {
    return this.query((p) => {
      const parts = p.split("/");
      return parts[parts.length - 2] === name;
    }, null);
  }

  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const ops: Array<() => void> = [];
    const tx = {
      get: async (ref: any) => this.snap(ref.path),
      getAll: async (...refs: any[]) => refs.map((r) => this.snap(r.path)),
      set: (ref: any, data: any, opts?: { merge?: boolean }) => {
        ops.push(() => this.write(ref.path, (cur) => (opts?.merge ? deepMerge(cur, data) : resolveValue(undefined, data))));
        return tx;
      },
      update: (ref: any, data: any) => {
        ops.push(() =>
          this.write(ref.path, (cur) => {
            if (cur === undefined) throw new Error(`update on missing doc ${ref.path}`);
            let out = clone(cur);
            for (const [k, v] of Object.entries(data)) {
              const nested: any = {};
              const parts = k.split(".");
              let c = nested;
              for (let i = 0; i < parts.length - 1; i++) c = c[parts[i]] = {};
              c[parts[parts.length - 1]] = v;
              out = deepMerge(out, nested);
            }
            return out;
          }),
        );
        return tx;
      },
      delete: (ref: any) => {
        ops.push(() => this.write(ref.path, () => undefined));
        return tx;
      },
    };
    const result = await fn(tx);
    ops.forEach((op) => op());
    return result;
  }

  /** Every doc except those under `excludePrefix`, for whole-state comparison. */
  snapshot(exclude: (path: string) => boolean = () => false): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [p, d] of [...this.docs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (!exclude(p)) out[p] = clone(d.data);
    }
    return out;
  }
}
