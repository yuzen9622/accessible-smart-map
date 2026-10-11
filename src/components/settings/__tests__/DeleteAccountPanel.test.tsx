import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteAccount,
  reauthenticateDeletionWithEmail,
  reauthenticateDeletionWithGoogle,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";
import type { UserDTO } from "@/types/user";

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  cleanups: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => `id-${hooks.cursor++}`,
  useRef: (value: unknown) => {
    const i = hooks.cursor++;
    hooks.slots[i] ??= { current: value };
    return hooks.slots[i];
  },
  useState: (value: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.slots)) hooks.slots[i] = value;
    return [
      hooks.slots[i],
      (next: unknown) => {
        hooks.slots[i] = next;
      },
    ];
  },
  useEffect: (fn: () => (() => void) | undefined, deps: unknown[]) => {
    const i = hooks.cursor++;
    const previous = hooks.slots[i] as unknown[] | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous[index])) {
      hooks.slots[i] = deps;
      const cleanup = fn();
      if (cleanup) hooks.cleanups.push(cleanup);
    }
  },
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (_key: string, options: { defaultValue: string }) =>
      options.defaultValue,
  }),
}));
vi.mock("@react-oauth/google", () => ({ GoogleLogin: () => null }));
vi.mock("@/lib/api/auth", () => ({
  deleteAccount: vi.fn(),
  reauthenticateDeletionWithEmail: vi.fn(),
  reauthenticateDeletionWithGoogle: vi.fn(),
}));
vi.mock("@/lib/authTransport", () => ({
  revokeSession: vi.fn().mockResolvedValue(undefined),
}));

import { GoogleLogin } from "@react-oauth/google";
import DeleteAccountPanel from "../DeleteAccountPanel";

type Element = ReactElement<Record<string, unknown>>;
const user: UserDTO = {
  _id: "A",
  email: "a@example.test",
  name: "A",
  authProviders: ["local", "google"],
  emailVerified: true,
  tokenVersion: 0,
};
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}
function render() {
  hooks.cursor = 0;
  return elements(
    DeleteAccountPanel({ user: useAuthStore.getState().user ?? user }),
  );
}
function find(predicate: (el: Element) => boolean) {
  const el = render().find(predicate);
  if (!el) throw new Error("Element not found");
  return el.props;
}
function click(label: string) {
  const props = find((el) => el.props.children === label && !!el.props.onClick);
  (props.onClick as () => void)();
}
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function confirmation() {
  render();
  click("永久刪除帳號");
  click("我了解，繼續");
}
function consent() {
  const props = find((el) => el.props.type === "checkbox");
  (props.onChange as (e: unknown) => void)({ target: { checked: true } });
}
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user, session: { accessToken: "old" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Real network forbidden");
    }),
  );
  vi.mocked(deleteAccount).mockResolvedValue({
    ok: true,
    code: 200,
    status: "success",
    message: "",
  });
});
afterEach(() => {
  hooks.cleanups.forEach((f) => {
    f();
  });
  hooks.cleanups = [];
  hooks.slots = [];
  hooks.cursor = 0;
  vi.unstubAllGlobals();
});
describe("DeleteAccountPanel", () => {
  it("explains retention and irreversibility, requires two steps and explicit consent", async () => {
    const tree = render();
    expect(
      tree.some((el) =>
        String(el.props.children).includes("危險通報會匿名化並保留"),
      ),
    ).toBe(true);
    expect(tree[0].props["aria-labelledby"]).toBeTruthy();
    click("永久刪除帳號");
    expect(deleteAccount).not.toHaveBeenCalled();
    click("我了解，繼續");
    expect(find((el) => el.props.children === "確認永久刪除").disabled).toBe(
      true,
    );
    consent();
    const submit = find((el) => el.props.children === "確認永久刪除")
      .onClick as () => void;
    submit();
    submit();
    await flush();
    expect(deleteAccount).toHaveBeenCalledOnce();
  });
  it("cancel resets confirmation and password intent", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", 403, "REAUTH_REQUIRED"),
    );
    confirmation();
    consent();
    click("確認永久刪除");
    await flush();
    const input = find((el) => el.props.type === "password");
    expect(input.id).toBeTruthy();
    (input.onChange as (e: unknown) => void)({ target: { value: "secret" } });
    click("取消");
    expect(render().some((el) => el.props.type === "password")).toBe(false);
    expect(reauthenticateDeletionWithEmail).not.toHaveBeenCalled();
    confirmation();
    expect(find((el) => el.props.type === "checkbox").checked).toBe(false);
  });
  it("password reauth clears password immediately and uses captured email", async () => {
    vi.mocked(deleteAccount).mockRejectedValueOnce(
      new ApiError("", 403, "REAUTH_REQUIRED"),
    );
    vi.mocked(reauthenticateDeletionWithEmail).mockResolvedValue({
      ok: false,
      code: 401,
      status: "error",
      message: "",
    });
    confirmation();
    consent();
    click("確認永久刪除");
    await flush();
    render();
    const input = find((el) => el.props.type === "password");
    (input.onChange as (e: unknown) => void)({ target: { value: "secret" } });
    const form = find((el) => el.type === "form");
    (form.onSubmit as (e: unknown) => void)({ preventDefault: vi.fn() });
    await flush();
    render();
    expect(reauthenticateDeletionWithEmail).toHaveBeenCalledWith(
      "a@example.test",
      "secret",
    );
    expect(find((el) => el.props.type === "password").value).toBe("");
  });
  it("Google callback after cancel cannot initiate login", async () => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", 403, "REAUTH_REQUIRED"),
    );
    confirmation();
    consent();
    click("確認永久刪除");
    await flush();
    const google = find((el) => el.type === GoogleLogin);
    click("取消");
    (google.onSuccess as (response: unknown) => void)({ credential: "late" });
    (google.onError as () => void)();
    await flush();
    expect(reauthenticateDeletionWithGoogle).not.toHaveBeenCalled();
    expect(render().some((el) => el.type === GoogleLogin)).toBe(false);
  });
  it("Apple linked users see mobile instruction with no confirmation or API", () => {
    useAuthStore.setState({
      user: { ...user, authProviders: ["apple", "google"] },
    });
    render();
    click("永久刪除帳號");
    expect(
      render().some((el) => String(el.props.children).includes("行動 App")),
    ).toBe(true);
    expect(render().some((el) => el.props.children === "確認永久刪除")).toBe(
      false,
    );
    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
