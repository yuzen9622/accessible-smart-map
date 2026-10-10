import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  epoch: 1,
  userId: "user-a" as string | null,
  cleanups: [] as (() => void)[],
  requestAuth: vi.fn(),
  invalidate: vi.fn(),
  report: vi.fn(),
  block: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "report-form",
  useRef: (value: unknown) => {
    const index = fixture.cursor++;
    fixture.slots[index] ??= { current: value };
    return fixture.slots[index];
  },
  useState: (value: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.slots)) fixture.slots[index] = value;
    return [
      fixture.slots[index],
      (next: unknown) => {
        fixture.slots[index] = next;
      },
    ];
  },
  useEffect: (effect: () => () => void) => {
    const index = fixture.cursor++;
    if (!(index in fixture.slots)) {
      fixture.slots[index] = true;
      fixture.cleanups.push(effect());
    }
  },
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/stores/useAuthStore", () => ({
  default: {
    getState: () => ({
      user: fixture.userId ? { _id: fixture.userId } : null,
      requestAuthDialog: fixture.requestAuth,
    }),
  },
}));
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: Object.assign(
    (selector: (s: { accountEpoch: number }) => unknown) =>
      selector({ accountEpoch: fixture.epoch }),
    { getState: () => ({ invalidateContent: fixture.invalidate }) },
  ),
  captureSafetyAccount: () => {
    const epoch = fixture.epoch;
    return () => epoch === fixture.epoch && Boolean(fixture.userId);
  },
}));
vi.mock("@/lib/api/content-safety", () => ({
  CONTENT_REPORT_REASONS: ["spam", "other"],
  submitContentReport: fixture.report,
  blockContentAuthor: fixture.block,
}));

import ContentSafetyMenu from "../ContentSafetyMenu";

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render() {
  fixture.cursor = 0;
  const outer = ContentSafetyMenu({
    target: { targetType: "review", targetId: "r1" },
  });
  if (!outer) throw new Error("Missing session");
  const props = outer.props;
  return (outer.type as (value: typeof props) => ReactElement)(props);
}
function find(predicate: (element: Element) => boolean) {
  const element = elements(render()).find(predicate);
  if (!element) throw new Error("Element not found");
  return element.props;
}
function action(label: string) {
  const props = find(
    (e) =>
      e.props.children === label ||
      (Array.isArray(e.props.children) && e.props.children.includes(label)),
  );
  (props.onSelect as () => void)();
}
function reason(value: string) {
  (find((e) => e.type === "select").onChange as (e: unknown) => void)({
    target: { value },
  });
}
function submit() {
  (find((e) => e.type === "form").onSubmit as (e: unknown) => void)({
    preventDefault: () => {},
  });
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
afterEach(() => {
  for (const cleanup of fixture.cleanups) cleanup();
  fixture.slots = [];
  fixture.cursor = 0;
  fixture.cleanups = [];
  fixture.epoch = 1;
  fixture.userId = "user-a";
  vi.clearAllMocks();
});

describe("content safety menu handlers", () => {
  it("routes unsigned users to normal login without submitting", () => {
    fixture.userId = null;
    action("safetyReport");
    expect(fixture.requestAuth).toHaveBeenCalledOnce();
    expect(fixture.report).not.toHaveBeenCalled();
  });
  it("requires a reason and details for Other", () => {
    action("safetyReport");
    submit();
    reason("other");
    submit();
    expect(fixture.report).not.toHaveBeenCalled();
    expect(find((e) => e.type === "textarea").required).toBe(true);
    expect(find((e) => e.type === "textarea").maxLength).toBe(1000);
  });
  it("prevents duplicate requests, keeps form input on failure and permits retry", async () => {
    let reject: (error: Error) => void = () => {};
    fixture.report.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    action("safetyReport");
    reason("spam");
    submit();
    submit();
    expect(fixture.report).toHaveBeenCalledTimes(1);
    reject(new Error("network"));
    await flush();
    expect(find((e) => e.props.role === "alert").children).toBe(
      "safetyActionError",
    );
    expect(find((e) => e.type === "select").value).toBe("spam");
    fixture.report.mockResolvedValueOnce({
      caseNumber: "CR-1",
      confirmationEmail: "unavailable",
    });
    submit();
    await flush();
    expect(
      elements(render()).some(
        (e) => e.props.children === "safetyEmailUnavailable",
      ),
    ).toBe(true);
  });
  it("discards a receipt after identity changes while submitting", async () => {
    let resolve: (value: object) => void = () => {};
    fixture.report.mockImplementationOnce(
      () =>
        new Promise((resolvePromise) => {
          resolve = resolvePromise;
        }),
    );
    action("safetyReport");
    reason("spam");
    submit();
    fixture.epoch++;
    resolve({ caseNumber: "PRIVATE", confirmationEmail: "queued" });
    await flush();
    expect(elements(render()).some((e) => e.props.role === "status")).toBe(
      false,
    );
    const outer = ContentSafetyMenu({
      target: { targetType: "review", targetId: "r1" },
    });
    expect(outer?.key).toBe("2:review:r1");
  });
  it("invalidates personalized content only after block succeeds", async () => {
    fixture.block.mockResolvedValueOnce(undefined);
    action("safetyBlock");
    submit();
    submit();
    await flush();
    expect(fixture.block).toHaveBeenCalledOnce();
    expect(fixture.invalidate).toHaveBeenCalledOnce();
  });
  it("does not offer actions for one's own content", () => {
    expect(
      ContentSafetyMenu({
        target: { targetType: "review", targetId: "mine" },
        isOwn: true,
      }),
    ).toBeNull();
  });
});
