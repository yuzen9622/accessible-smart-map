import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HazardReport } from "@/types/route";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  user: { _id: "a" } as { _id: string } | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = value;
    return [
      hooks.slots[index],
      (next: unknown) => {
        hooks.slots[index] =
          typeof next === "function" ? next(hooks.slots[index]) : next;
      },
    ];
  },
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { current: value };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as
      | { callback: unknown; deps: unknown[] }
      | undefined;
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      hooks.slots[index] = { callback, deps };
    return (hooks.slots[index] as { callback: unknown }).callback;
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.slots[index] as unknown[] | undefined;
    if (!previous || deps.some((dep, i) => dep !== previous[i])) {
      hooks.slots[index] = deps;
      hooks.effects.push(() => {
        hooks.cleanups[index]?.();
        hooks.cleanups[index] = effect() ?? (() => {});
      });
    }
  },
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ user: hooks.user }),
    { getState: () => ({ user: hooks.user }) },
  ),
}));
vi.mock("@/stores/useMapStore", () => ({
  default: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ map: null }),
    { getState: vi.fn() },
  ),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/lib/api/a11y", () => ({ getMyHazardReports: vi.fn() }));
vi.mock("../HazardReportResult", () => ({ default: () => null }));

import { getMyHazardReports } from "@/lib/api/a11y";
import MyReportsPanel, { MyReportsSession } from "../MyReportsPanel";

function render() {
  hooks.cursor = 0;
  const tree = MyReportsSession({ userId: "a" });
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function click(tree: ReactNode, text: string) {
  const target = nodes(tree).find(
    (node) => node.props.children === text && node.props.onClick,
  );
  expect(target).toBeDefined();
  if (!target) throw new Error("Button missing");
  (target.props.onClick as () => void)();
}
const report = (id: string): HazardReport => ({
  _id: id,
  publicPhotoUrl: null,
  hazardType: "obstacle",
  status: "expired",
  reportedLocation: { type: "Point", coordinates: [121, 25] },
  description: id,
});
const page = (ids: string[], nextCursor: string | null = null) => ({
  ok: true,
  data: { reports: ids.map(report), total: ids.length, nextCursor },
});
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.cleanups = [];
  hooks.effects = [];
  hooks.user = { _id: "a" };
  vi.clearAllMocks();
});
describe("my reports", () => {
  it("keys private state by account and shows login instead after logout", () => {
    expect(MyReportsPanel().key).toBe("a");
    hooks.user = { _id: "b" };
    expect(MyReportsPanel().key).toBe("b");
    hooks.user = null;
    expect(MyReportsPanel().type).not.toBe(MyReportsSession);
    expect(getMyHazardReports).not.toHaveBeenCalled();
  });
  it("retains the first page on failure, retries the cursor, and deduplicates", async () => {
    vi.mocked(getMyHazardReports)
      .mockResolvedValueOnce(page(["first"], "next") as never)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page(["first", "second"]) as never);
    render();
    await flush();
    click(render(), "myReportsMore");
    await flush();
    let tree = render();
    expect(nodes(tree).filter((node) => node.type === "li")).toHaveLength(1);
    expect(nodes(tree).some((node) => node.props.role === "alert")).toBe(true);
    click(tree, "myReportsRetry");
    await flush();
    tree = render();
    expect(getMyHazardReports).toHaveBeenLastCalledWith(
      "next",
      expect.any(AbortSignal),
    );
    expect(nodes(tree).filter((node) => node.type === "li")).toHaveLength(2);
    expect(
      nodes(tree).some((node) => node.props.children === "myReportsMore"),
    ).toBe(false);
  });
  it("ignores a late response after switching accounts", async () => {
    let resolve!: (value: never) => void;
    vi.mocked(getMyHazardReports).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    hooks.user = { _id: "b" };
    resolve(page(["private-a"]) as never);
    await flush();
    expect(nodes(render()).filter((node) => node.type === "li")).toHaveLength(
      0,
    );
  });
  it("aborts a pending request on unmount", () => {
    vi.mocked(getMyHazardReports).mockReturnValueOnce(new Promise(() => {}));
    render();
    const signal = vi.mocked(getMyHazardReports).mock.calls[0][1];
    for (const cleanup of hooks.cleanups) cleanup?.();
    expect(signal?.aborted).toBe(true);
  });
  it("distinguishes initial failure from an empty account", async () => {
    vi.mocked(getMyHazardReports)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page([]) as never);
    render();
    await flush();
    let tree = render();
    expect(
      nodes(tree).some((node) => node.props.children === "myReportsEmpty"),
    ).toBe(false);
    click(tree, "myReportsRetry");
    await flush();
    tree = render();
    expect(
      nodes(tree).some((node) => node.props.children === "myReportsEmpty"),
    ).toBe(true);
  });
});
