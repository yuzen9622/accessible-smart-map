import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/api/ai";
import { updateConfig } from "@/lib/api/user";
import { revokeSession } from "@/lib/authTransport";
import { ColorEnum, FontSizeEnum, LanguageEnum } from "@/lib/config";
import useAuthStore from "@/stores/useAuthStore";
import type { ChatBubble } from "@/stores/useChatStore";
import useChatStore from "@/stores/useChatStore";
import type { UserDTO } from "@/types/user";

vi.mock("@/lib/api/user", () => ({
  updateConfig: vi.fn().mockResolvedValue({
    ok: true,
    status: "success",
    code: 200,
  }),
}));

vi.mock("@/lib/authTransport", () => ({
  revokeSession: vi.fn().mockResolvedValue(undefined),
  requestRefresh: vi.fn().mockResolvedValue(null),
}));

const mockUpdateConfig = vi.mocked(updateConfig);
const mockRevokeSession = vi.mocked(revokeSession);

const USER: UserDTO = {
  _id: "user-1",
  name: "測試",
  email: "test@example.com",
  authProviders: ["local"],
  emailVerified: true,
  tokenVersion: 0,
};

describe("useAuthStore.updateUserConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      session: null,
      authDialogRequested: false,
      settingsDialogRequested: null,
      userConfig: {
        language: LanguageEnum.Chinese,
        darkMode: "system",
        themeColor: ColorEnum.Blue,
        fontSize: FontSizeEnum.Medium,
        notifications: false,
        highContrast: false,
        memoryEnabled: true,
      },
    });
  });

  it("sends remote config WITHOUT user_id (backend rejects user_id with 400)", () => {
    useAuthStore.getState().setUser(USER);
    useAuthStore.getState().updateUserConfig({ darkMode: "dark" });

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    const body = mockUpdateConfig.mock.calls[0][0];
    expect(body).toEqual({ darkMode: "dark" });
    expect(body).not.toHaveProperty("user_id");
  });

  it("only sends the whitelisted remote keys, not local-only fields", () => {
    useAuthStore.getState().setUser(USER);
    useAuthStore
      .getState()
      .updateUserConfig({ darkMode: "dark", highContrast: true });

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateConfig.mock.calls[0][0]).toEqual({ darkMode: "dark" });
  });

  it("does not call the API at all when logged out or for local-only changes", () => {
    // Logged out: remote save must not fire.
    useAuthStore.getState().updateUserConfig({ darkMode: "dark" });
    expect(mockUpdateConfig).not.toHaveBeenCalled();

    // Logged in, but only a local-only key changed: no remote call either.
    useAuthStore.getState().setUser(USER);
    useAuthStore.getState().updateUserConfig({ highContrast: true });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it("sends memoryEnabled when updated while logged in", () => {
    useAuthStore.getState().setUser(USER);
    useAuthStore.getState().updateUserConfig({ memoryEnabled: false });

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    expect(mockUpdateConfig.mock.calls[0][0]).toEqual({ memoryEnabled: false });
    expect(useAuthStore.getState().userConfig.memoryEnabled).toBe(false);
  });
});

describe("useAuthStore.logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      session: null,
      authDialogRequested: false,
      settingsDialogRequested: null,
      userConfig: {
        language: LanguageEnum.Chinese,
        darkMode: "system",
        themeColor: ColorEnum.Blue,
        fontSize: FontSizeEnum.Medium,
        notifications: false,
        highContrast: false,
        memoryEnabled: true,
      },
    });
    useChatStore.setState({
      hydrated: false,
      messages: [],
      input: "",
      isLoading: false,
      chatHistory: [],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears user and session synchronously", () => {
    useAuthStore.setState({
      user: USER,
      session: { accessToken: "test-access-token" },
    });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("clears AI chat conversation, chat history, and draft input in useChatStore for privacy protection", () => {
    useAuthStore.setState({
      user: USER,
      session: { accessToken: "test-access-token" },
    });

    const activeMessages: ChatBubble[] = [
      {
        role: "user",
        content: "我的住址在台北市中山區某路某號，我有輪椅代步需求",
      },
      {
        role: "assistant",
        content: "為您規劃捷運中山站無障礙路線與出入口資訊",
        toolActivities: [
          {
            name: "getAccessibleRoute",
            status: "done",
            result: { routeId: "r-123" },
          },
        ],
      },
    ];
    const activeHistory: ChatMessage[] = [
      {
        role: "user",
        content: "我的住址在台北市中山區某路某號，我有輪椅代步需求",
      },
      {
        role: "assistant",
        content: "為您規劃捷運中山站無障礙路線與出入口資訊",
      },
    ];

    useChatStore.setState({
      messages: activeMessages,
      chatHistory: activeHistory,
      input: "請問附近有無障礙坡道嗎？",
      isLoading: true,
    });

    expect(useChatStore.getState().messages).toHaveLength(2);
    expect(useChatStore.getState().chatHistory).toHaveLength(2);
    expect(useChatStore.getState().input).toBe("請問附近有無障礙坡道嗎？");

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().chatHistory).toEqual([]);
    expect(useChatStore.getState().input).toBe("");
  });

  it("drops persisted sessionStorage snapshot when window/sessionStorage is available", () => {
    const storeMap = new Map<string, string>();
    const mockSessionStorage = {
      getItem: vi.fn((key: string) => storeMap.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storeMap.set(key, value)),
      removeItem: vi.fn((key: string) => storeMap.delete(key)),
      clear: vi.fn(() => storeMap.clear()),
      length: 0,
      key: vi.fn(),
    };

    vi.stubGlobal("window", {});
    vi.stubGlobal("sessionStorage", mockSessionStorage);

    mockSessionStorage.setItem(
      "aiChatConversation",
      JSON.stringify({
        messages: [{ role: "user", content: "機密隱私資訊" }],
        chatHistory: [{ role: "user", content: "機密隱私資訊" }],
      }),
    );

    useAuthStore.setState({
      user: USER,
      session: { accessToken: "test-token" },
    });
    useChatStore.setState({
      messages: [{ role: "user", content: "機密隱私資訊" }],
      chatHistory: [{ role: "user", content: "機密隱私資訊" }],
    });

    useAuthStore.getState().logout();

    expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(
      "aiChatConversation",
    );
    expect(mockSessionStorage.getItem("aiChatConversation")).toBeNull();
  });

  it("invokes revokeSession when logged in", () => {
    useAuthStore.setState({
      user: USER,
      session: { accessToken: "token-to-revoke-123" },
    });

    useAuthStore.getState().logout();

    expect(mockRevokeSession).toHaveBeenCalledTimes(1);
    expect(mockRevokeSession).toHaveBeenCalledWith();
  });

  it("does not call revokeSession when logging out without an active session", () => {
    useAuthStore.setState({
      user: null,
      session: null,
    });

    useAuthStore.getState().logout();

    expect(mockRevokeSession).not.toHaveBeenCalled();
  });

  it("handles revokeSession failure gracefully without throwing or leaving dirty state", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockRevokeSession.mockRejectedValueOnce(
      new Error("Network failure during token revocation"),
    );

    useAuthStore.setState({
      user: USER,
      session: { accessToken: "error-token" },
    });
    useChatStore.setState({
      messages: [{ role: "user", content: "未清空的訊息" }],
      chatHistory: [{ role: "user", content: "未清空的訊息" }],
      input: "未發送的草稿",
    });

    expect(() => useAuthStore.getState().logout()).not.toThrow();

    // Allow promise rejection handler in catch block to execute
    await Promise.resolve();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useChatStore.getState().messages).toEqual([]);
    expect(useChatStore.getState().chatHistory).toEqual([]);
    expect(useChatStore.getState().input).toBe("");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
