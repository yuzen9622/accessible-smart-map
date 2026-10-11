import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/api/hazard-photo", () => ({ getHazardPhoto: vi.fn() }));

import { getHazardPhoto } from "@/lib/api/hazard-photo";
import HazardReportPhoto from "../HazardReportPhoto";

function render(variant: "thumbnail" | "detail" | "popup" = "thumbnail") {
  hooks.cursor = 0;
  const session = HazardReportPhoto({
    reportId: "r",
    retryable: true,
    variant,
  });
  const tree = (session.type as (props: typeof session.props) => ReactElement)(
    session.props,
  );
  for (const effect of hooks.effects.splice(0)) effect();
  return tree;
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  for (const cleanup of hooks.cleanups) cleanup?.();
  hooks.slots = [];
  hooks.cleanups = [];
  hooks.effects = [];
  hooks.user = { _id: "a" };
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
describe("report photo lifecycle", () => {
  it("uses a reserved, uncropped popup frame and a touch-sized retry", async () => {
    vi.mocked(getHazardPhoto).mockRejectedValueOnce(new Error("404"));
    const loading = nodes(render("popup")).find(
      (node) => node.props.role === "status",
    );
    expect(loading?.props.className).toContain("aspect-video");
    expect(loading?.props.className).toContain("object-contain");
    await flush();
    const retry = nodes(render("popup")).find(
      (node) => node.props.children === "myReportsRetry",
    );
    expect(retry?.props.className).toContain("min-h-11");
    expect(retry?.props.className).toContain("min-w-11");
  });
  it("renders only a local blob URL and revokes it on unmount", async () => {
    vi.mocked(getHazardPhoto).mockResolvedValueOnce(new Blob(["photo"]));
    const create = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:local-photo");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    render();
    await flush();
    const image = nodes(render()).find((node) => node.type === "img");
    expect(image?.props.src).toBe("blob:local-photo");
    expect(create).toHaveBeenCalledTimes(1);
    for (const cleanup of hooks.cleanups) cleanup?.();
    expect(revoke).toHaveBeenCalledWith("blob:local-photo");
  });
  it("shows failure and retries without ever using a storage URL", async () => {
    vi.mocked(getHazardPhoto)
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce(new Blob(["photo"]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:retried");
    render();
    await flush();
    const tree = render();
    expect(
      nodes(tree).some(
        (node) => node.props.children === "hazardPhotoUnavailable",
      ),
    ).toBe(true);
    expect(nodes(tree).some((node) => node.type === "img")).toBe(false);
    const retry = nodes(tree).find(
      (node) => node.props.children === "myReportsRetry",
    );
    if (!retry) throw new Error("Missing retry button");
    (retry.props.onClick as () => void)();
    render();
    await flush();
    expect(nodes(render()).find((node) => node.type === "img")?.props.src).toBe(
      "blob:retried",
    );
  });
  it("aborts unmounted loads and ignores late bytes", async () => {
    let resolve!: (blob: Blob) => void;
    vi.mocked(getHazardPhoto).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const create = vi.spyOn(URL, "createObjectURL");
    render();
    for (const cleanup of hooks.cleanups) cleanup?.();
    expect(vi.mocked(getHazardPhoto).mock.calls[0][1].aborted).toBe(true);
    resolve(new Blob(["late"]));
    await flush();
    expect(create).not.toHaveBeenCalled();
  });
  it("changes the image session key on account changes", () => {
    const first = HazardReportPhoto({ reportId: "r" }).key;
    hooks.user = { _id: "b" };
    expect(HazardReportPhoto({ reportId: "r" }).key).not.toBe(first);
  });
});
