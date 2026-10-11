import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountDeletion } from "@/lib/accountDeletion";
import {
  deleteAccount,
  reauthenticateDeletionWithEmail,
  reauthenticateDeletionWithGoogle,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";
import type { UserDTO } from "@/types/user";

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), clearChat: vi.fn() }));
vi.mock("@/lib/api/auth", () => ({
  deleteAccount: vi.fn(),
  reauthenticateDeletionWithEmail: vi.fn(),
  reauthenticateDeletionWithGoogle: vi.fn(),
}));
vi.mock("@/lib/authTransport", () => ({ revokeSession: mocks.revoke }));
vi.mock("@/stores/useChatStore", () => ({
  default: { getState: () => ({ clearAll: mocks.clearChat }) },
}));
const user = (id = "A", providers = ["local", "google"]): UserDTO => ({
  _id: id,
  name: id,
  email: `${id}@example.test`,
  authProviders: providers,
  emailVerified: true,
  tokenVersion: 0,
});
const response = (id = "A") => ({
  ok: true,
  code: 200,
  status: "success" as const,
  message: "",
  accessToken: "fresh",
  data: { user: user(id), config: useAuthStore.getState().userConfig },
});
const success = {
  ok: true,
  code: 200,
  status: "success" as const,
  message: "",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flows: ReturnType<typeof createAccountDeletion>[] = [];
function flow() {
  const listener = vi.fn();
  const f = createAccountDeletion(listener);
  flows.push(f);
  return { f, listener };
}
function confirm(f: ReturnType<typeof createAccountDeletion>) {
  f.begin();
  f.advance();
  return f.confirm();
}
async function needsReauth(f: ReturnType<typeof createAccountDeletion>) {
  vi.mocked(deleteAccount).mockRejectedValueOnce(
    new ApiError("", 403, "REAUTH_REQUIRED"),
  );
  await confirm(f);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Real network forbidden");
    }),
  );
  mocks.revoke.mockResolvedValue(undefined);
  useAuthStore.setState({ user: user(), session: { accessToken: "old" } });
  vi.mocked(deleteAccount).mockResolvedValue(success);
});
afterEach(() => {
  flows.splice(0).forEach((f) => {
    f.dispose();
  });
  vi.unstubAllGlobals();
});
describe("account deletion authorization and lifecycle", () => {
  it("requires both steps; cancel removes pending intent", async () => {
    const { f } = flow();
    await f.confirm();
    f.begin();
    await f.confirm();
    expect(deleteAccount).not.toHaveBeenCalled();
    f.advance();
    f.cancel();
    await f.confirm();
    expect(f.getState().phase).toBe("idle");
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it("cancel cannot open a parallel delete while the aborted request is still settling", async () => {
    const { f } = flow();
    const d = deferred<typeof success>();
    vi.mocked(deleteAccount).mockReturnValueOnce(d.promise);
    const task = confirm(f);
    f.cancel();
    await confirm(f);
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(f.getState().phase).toBe("idle");
    d.resolve(success);
    await task;
    expect(useAuthStore.getState().user?._id).toBe("A");
  });
  it("unmounted isolated login never mutates subsequent identity ABA", async () => {
    const { f } = flow();
    await needsReauth(f);
    const d = deferred<ReturnType<typeof response>>();
    vi.mocked(reauthenticateDeletionWithGoogle).mockReturnValue(d.promise);
    const task = f.reauthenticate("google", "credential");
    f.dispose();
    useAuthStore.setState({ user: user("B"), session: { accessToken: "B" } });
    useAuthStore.setState({ user: user(), session: { accessToken: "newA" } });
    d.resolve(response("B"));
    await task;
    expect(useAuthStore.getState().session?.accessToken).toBe("newA");
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(deleteAccount).toHaveBeenCalledOnce();
  });
  it("incomplete successful login is discarded without session mutation", async () => {
    const { f } = flow();
    await needsReauth(f);
    vi.mocked(reauthenticateDeletionWithGoogle).mockResolvedValue({
      ...response(),
      accessToken: undefined,
    });
    await f.reauthenticate("google", "credential");
    expect(f.getState().message).toBe("wrongAccount");
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    expect(mocks.clearChat).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("reauth response with a newly revealed Apple link cannot retry on web", async () => {
    const { f } = flow();
    await needsReauth(f);
    const result = response();
    result.data.user.authProviders.push("apple");
    vi.mocked(reauthenticateDeletionWithEmail).mockResolvedValue(result);
    await f.reauthenticate("local", "secret");
    expect(f.getState().message).toBe("apple");
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    expect(mocks.clearChat).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("clears local/chat only after verified 200, with no server logout", async () => {
    const { f } = flow();
    await confirm(f);
    expect(f.getState().message).toBe("deleted");
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect(mocks.clearChat).toHaveBeenCalledOnce();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each([
    ["NOT_FOUND", true],
    [undefined, false],
    ["OTHER", false],
  ])("classifies endpoint404 reason %s precisely", async (reason, deleted) => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", 404, reason as string | undefined),
    );
    const { f } = flow();
    await confirm(f);
    expect(f.getState().message === "deleted").toBe(deleted);
    expect(useAuthStore.getState().user === null).toBe(deleted);
  });
  it("preserves business403 and reauthenticates captured email before retry once", async () => {
    const { f } = flow();
    await needsReauth(f);
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    vi.mocked(reauthenticateDeletionWithEmail).mockResolvedValue(response());
    await f.reauthenticate("local", "secret");
    expect(reauthenticateDeletionWithEmail).toHaveBeenCalledWith(
      "A@example.test",
      "secret",
    );
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deleteAccount).mock.calls[1][2]).toBe("fresh");
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(f.getState().message).toBe("deleted");
  });
  it("accepts config:null and keeps fresh bearer private through retry", async () => {
    const { f } = flow();
    await needsReauth(f);
    const before = useAuthStore.getState();
    const result = {
      ...response(),
      data: { user: { ...user(), name: "fresh name" }, config: null },
    };
    vi.mocked(reauthenticateDeletionWithEmail).mockResolvedValue(result);
    const pending = deferred<typeof success>();
    vi.mocked(deleteAccount).mockReturnValueOnce(pending.promise);
    const task = f.reauthenticate("local", "secret");
    await Promise.resolve();
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deleteAccount).mock.calls[1][2]).toBe("fresh");
    expect(useAuthStore.getState().user).toBe(before.user);
    expect(useAuthStore.getState().userConfig).toBe(before.userConfig);
    expect(useAuthStore.getState().session).toBe(before.session);
    pending.resolve(success);
    await task;
    expect(f.getState().message).toBe("deleted");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not loop reauthentication when retry still requires fresh sign-in", async () => {
    const { f } = flow();
    await needsReauth(f);
    vi.mocked(reauthenticateDeletionWithGoogle).mockResolvedValue(response());
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", 403, "REAUTH_REQUIRED"),
    );
    await f.reauthenticate("google", "credential");
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(f.getState().message).toBe("reauthFailed");
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    expect(vi.mocked(deleteAccount).mock.calls[1][2]).toBe("fresh");
    expect(mocks.clearChat).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("wrong Google identity never commits/retries or logs out", async () => {
    const { f } = flow();
    await needsReauth(f);
    vi.mocked(reauthenticateDeletionWithGoogle).mockResolvedValue(
      response("B"),
    );
    await f.reauthenticate("google", "credential");
    expect(deleteAccount).toHaveBeenCalledOnce();
    expect(f.getState().message).toBe("wrongAccount");
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    expect(useAuthStore.getState().user?._id).toBe("A");
    expect(mocks.clearChat).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each(["switch", "ABA", "logout"])(
    "late reauth cannot overwrite/revoke %s identity epoch",
    async (kind) => {
      const { f } = flow();
      await needsReauth(f);
      const d = deferred<ReturnType<typeof response>>();
      vi.mocked(reauthenticateDeletionWithGoogle).mockReturnValue(d.promise);
      const task = f.reauthenticate("google", "credential");
      useAuthStore.setState({
        user: kind === "logout" ? null : user("B"),
        session: kind === "logout" ? null : { accessToken: "B" },
      });
      if (kind === "ABA")
        useAuthStore.setState({
          user: user(),
          session: { accessToken: "newA" },
        });
      const before = useAuthStore.getState().session;
      d.resolve(response("B"));
      await task;
      expect(useAuthStore.getState().session).toBe(before);
      expect(deleteAccount).toHaveBeenCalledOnce();
      expect(mocks.revoke).not.toHaveBeenCalled();
    },
  );
  it.each(["cancel", "unmount"])(
    "late successful login after %s leaves session unchanged, never retries",
    async (kind) => {
      const { f, listener } = flow();
      await needsReauth(f);
      const d = deferred<ReturnType<typeof response>>();
      vi.mocked(reauthenticateDeletionWithEmail).mockReturnValue(d.promise);
      const task = f.reauthenticate("local", "secret");
      if (kind === "cancel") f.cancel();
      else f.dispose();
      const calls = listener.mock.calls.length;
      d.resolve(response());
      await task;
      expect(deleteAccount).toHaveBeenCalledOnce();
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(listener.mock.calls.length).toBe(calls);
      expect(useAuthStore.getState().session?.accessToken).toBe("old");
      expect(mocks.clearChat).not.toHaveBeenCalled();
    },
  );
  it.each(["switch", "ABA", "cancel", "unmount"])(
    "late deletion success cannot clear new account or cancelled lifetime: %s",
    async (kind) => {
      const { f, listener } = flow();
      const d = deferred<typeof success>();
      vi.mocked(deleteAccount).mockReturnValue(d.promise);
      const task = confirm(f);
      const guard = vi.mocked(deleteAccount).mock.calls[0][0];
      expect(guard()).toBe(true);
      if (kind === "cancel") f.cancel();
      else if (kind === "unmount") f.dispose();
      else {
        useAuthStore.setState({ user: user("B") });
        if (kind === "ABA") useAuthStore.setState({ user: user() });
      }
      const before = useAuthStore.getState().user;
      const calls = listener.mock.calls.length;
      expect(guard()).toBe(false);
      d.resolve(success);
      await task;
      expect(useAuthStore.getState().user).toBe(before);
      expect(listener.mock.calls.length).toBe(calls);
      expect(mocks.clearChat).not.toHaveBeenCalled();
    },
  );
  it("blocks double deletion and double sign-in", async () => {
    const { f } = flow();
    const d = deferred<typeof success>();
    vi.mocked(deleteAccount).mockReturnValueOnce(d.promise);
    const task = confirm(f);
    await f.confirm();
    expect(deleteAccount).toHaveBeenCalledOnce();
    d.resolve(success);
    await task;
    useAuthStore.setState({ user: user(), session: { accessToken: "old" } });
    const { f: g } = flow();
    await needsReauth(g);
    const login = deferred<ReturnType<typeof response>>();
    vi.mocked(reauthenticateDeletionWithGoogle).mockReturnValue(login.promise);
    const reauth = g.reauthenticate("google", "one");
    await g.reauthenticate("google", "two");
    expect(reauthenticateDeletionWithGoogle).toHaveBeenCalledOnce();
    login.resolve(response());
    await reauth;
  });
  it("Apple-linked mixed-provider account never issues a DELETE", async () => {
    useAuthStore.setState({ user: user("A", ["apple", "google", "local"]) });
    const { f } = flow();
    await confirm(f);
    expect(f.getState().message).toBe("apple");
    expect(deleteAccount).not.toHaveBeenCalled();
  });
  it.each([
    [403, "APPLE_AUTHORIZATION_REQUIRED", "apple"],
    [403, "APPLE_AUTHORIZATION_INVALID", "apple"],
    [503, "APPLE_REVOKE_UNAVAILABLE", "appleUnavailable"],
    [503, undefined, "failed"],
    [500, undefined, "partial"],
  ])("honest failure %s %s preserves login", async (code, reason, message) => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", code as number, reason as string | undefined),
    );
    const { f } = flow();
    await confirm(f);
    expect(f.getState().message).toBe(message);
    expect(useAuthStore.getState().user?._id).toBe("A");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it.each([
    [401, undefined],
    [403, undefined],
    [403, "INVALID_TOKEN"],
  ])("invalid auth %s %s clears only local", async (code, reason) => {
    vi.mocked(deleteAccount).mockRejectedValue(
      new ApiError("", code as number, reason as string | undefined),
    );
    const { f } = flow();
    await confirm(f);
    expect(f.getState().message).toBe("expired");
    expect(useAuthStore.getState().session).toBeNull();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("failed password sign-in preserves session and does not retry deletion", async () => {
    const { f } = flow();
    await needsReauth(f);
    vi.mocked(reauthenticateDeletionWithEmail).mockRejectedValue(
      new ApiError("", 401),
    );
    await f.reauthenticate("local", "wrong");
    expect(f.getState().phase).toBe("reauth");
    expect(useAuthStore.getState().session?.accessToken).toBe("old");
    expect(deleteAccount).toHaveBeenCalledOnce();
  });
});
