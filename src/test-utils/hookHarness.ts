/**
 * Minimal React-hooks harness for vitest's node environment.
 *
 * The repo has no jsdom / @testing-library/react, so hook tests swap the
 * `react` module for this harness:
 *
 *   vi.mock("react", async () => (await import("@/test-utils/hookHarness")).reactMock);
 *
 * and then drive a hook with `renderHook(() => useThing(props))`. Effects run
 * after each render (cleanup of the previous run first, like React), and any
 * setState re-renders synchronously until the tree is stable. Good enough for
 * subscription/state-machine tests; it is NOT a full React implementation.
 */

type Slot = any;

let current: Harness<any> | null = null;

function depsEqual(a?: readonly unknown[], b?: readonly unknown[]) {
  if (!a || !b) return false;
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

class Harness<R> {
  slots: Slot[] = [];
  i = 0;
  dirty = false;
  pending: (() => void)[] = [];
  result!: R;
  unmounted = false;
  busy = false;
  constructor(public fn: () => R) {}

  renderOnce() {
    const prev = current;
    current = this;
    this.i = 0;
    this.dirty = false;
    try {
      this.result = this.fn();
    } finally {
      current = prev;
    }
    const effects = this.pending.splice(0);
    for (const e of effects) e();
  }

  render() {
    if (this.unmounted || this.busy) return;
    this.busy = true;
    try {
      this.renderOnce();
      let guard = 0;
      while (this.dirty) {
        if (++guard > 50) throw new Error("hookHarness: render loop");
        this.renderOnce();
      }
    } finally {
      this.busy = false;
    }
  }

  unmount() {
    this.unmounted = true;
    for (const s of this.slots) if (s && typeof s.cleanup === "function") s.cleanup();
  }
}

function h(): Harness<any> {
  if (!current) throw new Error("hookHarness: hook called outside renderHook");
  return current;
}

function useState<T>(init: T | (() => T)) {
  const H = h();
  const i = H.i++;
  if (!H.slots[i]) {
    const cell: any = { value: typeof init === "function" ? (init as any)() : init };
    cell.set = (v: any) => {
      const next = typeof v === "function" ? v(cell.value) : v;
      if (Object.is(next, cell.value)) return;
      cell.value = next;
      if (H.unmounted) return;
      H.dirty = true;
      if (!H.busy) H.render();
    };
    H.slots[i] = cell;
  }
  return [H.slots[i].value as T, H.slots[i].set as (v: T | ((p: T) => T)) => void] as const;
}

function useRef<T>(init: T) {
  const H = h();
  const i = H.i++;
  return (H.slots[i] ||= { current: init }) as { current: T };
}

function useMemo<T>(fn: () => T, deps: readonly unknown[]) {
  const H = h();
  const i = H.i++;
  const old = H.slots[i];
  if (!old || !depsEqual(old.deps, deps)) H.slots[i] = { deps, value: fn() };
  return H.slots[i].value as T;
}

function useCallback<T>(fn: T, deps: readonly unknown[]) {
  return useMemo(() => fn, deps);
}

function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]) {
  const H = h();
  const i = H.i++;
  const old = H.slots[i];
  if (old && deps && depsEqual(old.deps, deps)) return;
  const slot: any = { deps, cleanup: old?.cleanup };
  H.slots[i] = slot;
  H.pending.push(() => {
    if (typeof slot.cleanup === "function") slot.cleanup();
    const c = fn();
    slot.cleanup = typeof c === "function" ? c : undefined;
  });
}

function createContext<T>(defaultValue: T) {
  const ctx: any = { _value: defaultValue };
  ctx.Provider = function Provider() { return null; };
  return ctx;
}

function useContext<T>(ctx: any): T {
  return ctx._value;
}

const api = {
  useState,
  useRef,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect: useEffect,
  createContext,
  useContext,
};

export const reactMock = { __esModule: true, ...api, default: api };

export function renderHook<R>(fn: () => R) {
  const H = new Harness(fn);
  H.render();
  return {
    get result() {
      return H.result;
    },
    rerender() {
      H.render();
    },
    unmount() {
      H.unmount();
    },
  };
}
