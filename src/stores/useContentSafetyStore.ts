import { create } from "zustand";
import useAuthStore from "@/stores/useAuthStore";

/** Never persisted: an identity transition invalidates every in-flight action. */
const useContentSafetyStore = create<{
  accountEpoch: number;
  revision: number;
  invalidateContent: () => void;
}>((set) => ({
  accountEpoch: 0,
  revision: 0,
  invalidateContent: () => set((s) => ({ revision: s.revision + 1 })),
}));

useAuthStore.subscribe((next, previous) => {
  if (
    next.user?._id !== previous.user?._id ||
    Boolean(next.session?.accessToken) !==
      Boolean(previous.session?.accessToken)
  ) {
    useContentSafetyStore.setState((s) => ({
      accountEpoch: s.accountEpoch + 1,
      revision: s.revision + 1,
    }));
  }
});

export function captureSafetyAccount(allowAnonymous = false) {
  const userId = useAuthStore.getState().user?._id;
  const epoch = useContentSafetyStore.getState().accountEpoch;
  return () =>
    (allowAnonymous || Boolean(userId)) &&
    userId === useAuthStore.getState().user?._id &&
    epoch === useContentSafetyStore.getState().accountEpoch;
}

export default useContentSafetyStore;
