import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "@/types/review";

const fixture = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
  epoch: 1,
  revision: 0,
  user: { _id: "u" } as { _id: string } | null,
  list: vi.fn(),
  summary: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useRef: (value: unknown) => {
    const i = fixture.cursor++;
    fixture.slots[i] ??= { current: value };
    return fixture.slots[i];
  },
  useState: (value: unknown) => {
    const i = fixture.cursor++;
    if (!(i in fixture.slots))
      fixture.slots[i] = typeof value === "function" ? value() : value;
    return [
      fixture.slots[i],
      (next: unknown) => {
        fixture.slots[i] =
          typeof next === "function" ? next(fixture.slots[i]) : next;
      },
    ];
  },
  useEffect: (fn: () => () => void) => {
    const i = fixture.cursor++;
    if (!(i in fixture.slots)) {
      fixture.slots[i] = true;
      fixture.cleanups.push(fn());
    }
  },
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: fixture.success, error: fixture.error },
}));
vi.mock("@/stores/useAuthStore", () => ({
  default: (selector: (s: object) => unknown) =>
    selector({ user: fixture.user, requestAuthDialog: vi.fn() }),
}));
vi.mock("@/stores/useContentSafetyStore", () => ({
  default: Object.assign(
    (selector: (s: object) => unknown) =>
      selector({ accountEpoch: fixture.epoch, revision: fixture.revision }),
    {
      getState: () => ({
        accountEpoch: fixture.epoch,
        revision: fixture.revision,
      }),
    },
  ),
}));
vi.mock("@/lib/api/review", () => ({
  getPlaceReviews: fixture.list,
  getReviewSummary: fixture.summary,
  createReview: fixture.create,
  updateReview: fixture.update,
  deleteReview: fixture.remove,
}));

import { fromReviewEvidence } from "@/lib/reviewEvidence";
import PlaceReviewSection from "../PlaceReviewSection";
import { ReviewEvidenceFields } from "../ReviewEvidence";

type Element = ReactElement<Record<string, unknown>>;
const own: ReviewItem = {
  _id: "r",
  userId: "u",
  rating: 3,
  passageWidthRating: 1,
  toiletRating: 2,
  elevatorRating: 3,
  serviceRating: 4,
  toiletTurningRoom: false,
  createdAt: "2026-10-11",
};
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}
function render(placeId = "p") {
  fixture.cursor = 0;
  const outer = PlaceReviewSection({ placeId, placeType: "osm" });
  return (outer.type as (props: typeof outer.props) => ReactElement)(
    outer.props,
  );
}
function find(predicate: (el: Element) => boolean) {
  const el = elements(render()).find(predicate);
  if (!el) throw new Error("Not found");
  return el.props;
}
function click(label: string) {
  const props = find(
    (e) =>
      e.props.children === label ||
      (Array.isArray(e.props.children) && e.props.children.includes(label)),
  );
  return (props.onClick as () => Promise<void>)();
}
function evidence() {
  return find((e) => e.type === ReviewEvidenceFields);
}
function rateAll() {
  for (const el of elements(render()).filter(
    (e) => e.props.label && e.props.onChange,
  ))
    (el.props.onChange as (v: number) => void)(4);
}
function mount(items: ReviewItem[] = []) {
  fixture.list.mockResolvedValue({
    ok: true,
    data: { items, page: 1, totalPages: 1, totalCount: items.length },
  });
  fixture.summary.mockResolvedValue({ ok: true, data: {} });
  render();
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
afterEach(() => {
  fixture.cleanups.forEach((fn) => {
    fn();
  });
  fixture.cleanups = [];
  fixture.slots = [];
  fixture.cursor = 0;
  fixture.epoch = 1;
  fixture.revision = 0;
  fixture.user = { _id: "u" };
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("place review form and session lifecycle", () => {
  it("creates observed false, keeps mandatory ratings, resets form after success", async () => {
    mount();
    await flush();
    click("writeReview");
    rateAll();
    (evidence().onChange as (v: unknown) => void)({
      ...fromReviewEvidence(),
      adequateAisleWidth: "no",
    });
    fixture.create.mockResolvedValue({ ok: true });
    await click("submitReview");
    expect(fixture.create.mock.calls[0][0]).toEqual({
      placeId: "p",
      placeType: "osm",
      passageWidthRating: 4,
      toiletRating: 4,
      elevatorRating: 4,
      serviceRating: 4,
      adequateAisleWidth: false,
      comment: undefined,
    });
    expect(fixture.success).toHaveBeenCalledWith("reviewSubmitted");
    click("writeReview");
    expect(evidence().value).toEqual(fromReviewEvidence());
  });
  it("prefills edit ratings/false and PATCH does not introduce missing evidence", async () => {
    mount([own]);
    await flush();
    click("reviewEditYours");
    expect(evidence().persisted).toEqual(fromReviewEvidence(own));
    fixture.update.mockResolvedValue({ ok: true });
    await click("reviewUpdate");
    expect(fixture.update.mock.calls[0].slice(0, 2)).toEqual([
      "r",
      {
        passageWidthRating: 1,
        toiletRating: 2,
        elevatorRating: 3,
        serviceRating: 4,
        toiletTurningRoom: false,
        comment: undefined,
      },
    ]);
  });
  it("cancel/new clears optional state and blocks incomplete ratings", async () => {
    mount();
    await flush();
    click("writeReview");
    (evidence().onChange as (v: unknown) => void)(
      fromReviewEvidence({ staffHelpfulnessRating: 4 }),
    );
    click("cancel");
    click("writeReview");
    expect(evidence().value).toEqual(fromReviewEvidence());
    await click("submitReview");
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.error).toHaveBeenCalledWith("reviewRatingRequired");
  });
  it("keeps input open on failed response and prevents duplicate in-flight submit", async () => {
    mount([own]);
    await flush();
    click("reviewEditYours");
    let resolve: (value: object) => void = () => {};
    fixture.update.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const submit = click("reviewUpdate");
    click("reviewUpdate");
    expect(fixture.update).toHaveBeenCalledOnce();
    resolve({ ok: false });
    await submit;
    expect(evidence().value).toEqual(fromReviewEvidence(own));
    expect(fixture.success).not.toHaveBeenCalled();
  });
  it.each(["account ABA", "safety revision", "place/unmount"])(
    "late success cannot toast, close or reload after %s",
    async (change) => {
      mount([own]);
      await flush();
      click("reviewEditYours");
      let resolve: (value: object) => void = () => {};
      fixture.update.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const submit = click("reviewUpdate");
      if (change === "account ABA") fixture.epoch += 2;
      else if (change === "safety revision") fixture.revision++;
      else
        fixture.cleanups.forEach((fn) => {
          fn();
        });
      const guard = fixture.update.mock.calls[0][2];
      expect(guard()).toBe(false);
      resolve({ ok: true });
      await submit;
      expect(fixture.success).not.toHaveBeenCalled();
      expect(fixture.error).not.toHaveBeenCalled();
      expect(fixture.list).toHaveBeenCalledOnce();
      expect(evidence().value).toEqual(fromReviewEvidence(own));
      expect(PlaceReviewSection({ placeId: "new", placeType: "osm" }).key).toBe(
        `new:osm:${fixture.epoch}:${fixture.revision}`,
      );
    },
  );
  it("silences late failure after account change", async () => {
    mount([own]);
    await flush();
    click("reviewEditYours");
    let reject: (value: Error) => void = () => {};
    fixture.update.mockImplementation(
      () =>
        new Promise((_r, fail) => {
          reject = fail;
        }),
    );
    const submit = click("reviewUpdate");
    fixture.epoch++;
    reject(new Error("private"));
    await submit;
    expect(fixture.error).not.toHaveBeenCalled();
  });
  it("remounts fresh optional state after place or account switch", async () => {
    mount([own]);
    await flush();
    click("reviewEditYours");
    fixture.cleanups.forEach((fn) => {
      fn();
    });
    fixture.cleanups = [];
    fixture.slots = [];
    fixture.epoch++;
    fixture.user = { _id: "other" };
    fixture.list.mockResolvedValue({
      ok: true,
      data: { items: [], page: 1, totalPages: 1, totalCount: 0 },
    });
    render("new");
    await flush();
    // A real keyed remount uses the new target; inspect this new instance directly.
    fixture.cursor = 0;
    const outer = PlaceReviewSection({ placeId: "new", placeType: "osm" });
    expect(outer.key).toBe("new:osm:2:0");
    const tree = (outer.type as (props: typeof outer.props) => ReactElement)(
      outer.props,
    );
    expect(elements(tree).some((el) => el.type === ReviewEvidenceFields)).toBe(
      false,
    );
    const create = elements(tree).find(
      (el) =>
        el.props.children === "writeReview" ||
        (Array.isArray(el.props.children) &&
          el.props.children.includes("writeReview")),
    );
    if (!create) throw new Error("Missing create control");
    (create.props.onClick as () => void)();
    fixture.cursor = 0;
    const fresh = (outer.type as (props: typeof outer.props) => ReactElement)(
      outer.props,
    );
    const fields = elements(fresh).find(
      (el) => el.type === ReviewEvidenceFields,
    );
    expect(fields?.props.value).toEqual(fromReviewEvidence());
    expect(fields?.props.persisted).toEqual(fromReviewEvidence());
  });
  it("ignores late initial data after account change before remount", async () => {
    let release: (value: object) => void = () => {};
    fixture.list.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    fixture.summary.mockResolvedValue({ ok: true, data: { summary: "old" } });
    render();
    fixture.epoch++;
    release({
      ok: true,
      data: { items: [own], page: 1, totalPages: 1, totalCount: 1 },
    });
    await flush();
    expect(elements(render()).some((el) => el.key === own._id)).toBe(false);
    expect(fixture.error).not.toHaveBeenCalled();
  });
  it("fences delete results after account change and does not refresh another session", async () => {
    vi.stubGlobal("window", { confirm: () => true });
    mount([own]);
    await flush();
    let release: (value: object) => void = () => {};
    fixture.remove.mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const pending = click("reviewDelete");
    fixture.epoch++;
    expect(fixture.remove.mock.calls[0][1]()).toBe(false);
    release({ ok: true });
    await pending;
    expect(fixture.success).not.toHaveBeenCalled();
    expect(fixture.error).not.toHaveBeenCalled();
    expect(fixture.list).toHaveBeenCalledOnce();
  });
});
