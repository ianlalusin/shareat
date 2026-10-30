import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeSnapshots, querySnap } from "@/test-utils/fakeSnapshots";

/**
 * F18: the cashier home's active-sessions listener must end loading on error
 * and show a specific error + retry — never an endless spinner or an empty
 * "No active sessions" grid. Child components are stubs; the test inspects
 * the element tree SessionListView returns.
 */

const fake = vi.hoisted(() => ({ impl: null as any, activeStore: { id: "a" } as any }));

vi.mock("react", async () => (await import("@/test-utils/hookHarness")).reactMock);
vi.mock("@/lib/firebase/client", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join("/") }),
  query: (base: any, ...c: any[]) => ({ ...base, c }),
  orderBy: (...a: any[]) => a,
  onSnapshot: (...a: any[]) => fake.impl.onSnapshot(...a),
  deleteDoc: vi.fn(), doc: vi.fn(), updateDoc: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/context/auth-context", () => ({ useAuthContext: () => ({ appUser: { uid: "u" }, isSigningOut: false }) }));
vi.mock("@/context/store-context", () => ({ useStoreContext: () => ({ activeStore: fake.activeStore }) }));
vi.mock("@/context/local-profile-context", () => ({ useLocalProfile: () => ({ currentProfile: null }) }));
vi.mock("@/hooks/useStoreConfigDoc", () => ({
  useStoreConfigDoc: () => ({ config: { packages: [], flavors: [], schedules: [] }, isLoading: false, error: null, retry: () => {} }),
}));
vi.mock("@/hooks/useWeatherLogger", () => ({ useWeatherLogger: () => ({ isModalOpen: false, closeModal: () => {} }) }));
vi.mock("@/lib/reservations/seat-handoff", () => ({ takeReservationSeatHandoff: () => null }));
vi.mock("@/lib/reservations/history", () => ({ reservationEvent: vi.fn(), appendReservationEvent: vi.fn() }));
vi.mock("@/lib/utils/isScheduleActiveNow", () => ({ isScheduleActiveNow: () => true }));

const { stubs } = vi.hoisted(() => {
  const stub = (name: string) => Object.defineProperty(function () { return null; }, "name", { value: name });
  return { stubs: (...names: string[]) => Object.fromEntries(names.map((n) => [n, stub(n)])) };
});
vi.mock("lucide-react", () => stubs("Loader2", "AlertCircle", "Banknote"));
vi.mock("@/components/page-header", () => stubs("PageHeader"));
vi.mock("@/components/ui/button", () => stubs("Button"));
vi.mock("@/components/ui/alert", () => stubs("Alert", "AlertDescription", "AlertTitle"));
vi.mock("@/components/ui/accordion", () => stubs("Accordion", "AccordionContent", "AccordionItem", "AccordionTrigger"));
vi.mock("@/components/ui/card", () => stubs("Card", "CardDescription", "CardHeader", "CardTitle"));
vi.mock("@/components/cashier/start-session-form", () => stubs("StartSessionForm"));
vi.mock("@/components/cashier/active-sessions-grid", () => stubs("ActiveSessionsGrid"));
vi.mock("@/components/cashier/past-sessions-card", () => stubs("PastSessionsCard"));
vi.mock("@/components/cashier/ApprovalQueue", () => stubs("ApprovalQueue"));
vi.mock("./SyncSessionsTool", () => stubs("SyncSessionsTool"));
vi.mock("./CashierTargetProgressCard", () => stubs("CashierTargetProgressCard"));
vi.mock("./CashierTipController", () => stubs("CashierTipController"));
vi.mock("./WaitlistCard", () => stubs("WaitlistCard"));
vi.mock("@/components/shared/WeatherLoggerModal", () => stubs("WeatherLoggerModal"));
vi.mock("@/components/dashboard/WeatherLogFloatingButton", () => stubs("WeatherLogFloatingButton"));

import { renderHook } from "@/test-utils/hookHarness";
import { SessionListView, useActiveSessions, describeSessionsError } from "./session-list-view";

function nodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const find = (tree: any, name: string) => nodes(tree).filter((n) => n.type?.name === name);

let snaps: ReturnType<typeof createFakeSnapshots>;
const sessionListeners = () => snaps.listeners.filter((l) => String(l.ref?.path).endsWith("/activeSessions"));
const tableListener = () => snaps.listeners.find((l) => String(l.ref?.path).endsWith("/tables"))!;

beforeEach(() => {
  snaps = createFakeSnapshots();
  fake.impl = snaps;
  fake.activeStore = { id: "a" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("SessionListView active sessions (F18)", () => {
  it("initial listener denial: spinner ends, specific error + retry shown, no empty grid", () => {
    const h = renderHook(() => SessionListView());
    tableListener().next(querySnap([]));
    expect(find(h.result, "Loader2")).toHaveLength(1);

    sessionListeners()[0].error!(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));

    expect(find(h.result, "Loader2")).toHaveLength(0);
    const alert = nodes(h.result).find((n) => n.props?.["data-testid"] === "active-sessions-error");
    expect(alert).toBeTruthy();
    const text = JSON.stringify(alert.props.children);
    expect(text).toContain("permission");
    expect(find(alert, "Button")).toHaveLength(1);
    // Not presented as "No active sessions".
    expect(find(h.result, "ActiveSessionsGrid")).toHaveLength(0);

    // Retry re-subscribes (one live listener) and recovers.
    find(alert, "Button")[0].props.onClick();
    expect(sessionListeners().filter((l) => l.active)).toHaveLength(1);
    sessionListeners()[1].next(querySnap([{ id: "s1", startedAtClientMs: 1 }]));
    expect(nodes(h.result).some((n) => n.props?.["data-testid"] === "active-sessions-error")).toBe(false);
    expect(find(h.result, "ActiveSessionsGrid")[0].props.sessions.map((s: any) => s.id)).toEqual(["s1"]);
  });

  it("error after a successful snapshot keeps last-known rows, marked stale", () => {
    const h = renderHook(() => useActiveSessions("a", true));
    sessionListeners()[0].next(querySnap([{ id: "s1", startedAtClientMs: 1 }]));
    sessionListeners()[0].error!(Object.assign(new Error("offline"), { code: "unavailable" }));
    expect(h.result.isLoading).toBe(false);
    expect(h.result.error?.message).toBe("offline");
    expect(h.result.sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(describeSessionsError(h.result.error)).toMatch(/server/);
  });

  it("store switch clears the previous store's sessions and ignores its late events", () => {
    let storeId = "a";
    const h = renderHook(() => useActiveSessions(storeId, true));
    sessionListeners()[0].next(querySnap([{ id: "a1" }]));
    storeId = "b";
    h.rerender();
    expect(h.result.sessions).toEqual([]);
    expect(h.result.isLoading).toBe(true);
    sessionListeners()[0].next(querySnap([{ id: "a2" }]));
    sessionListeners()[0].error!(new Error("late"));
    expect(h.result.sessions).toEqual([]);
    expect(h.result.error).toBeNull();
  });
});
