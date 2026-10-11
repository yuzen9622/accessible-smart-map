import {
  deleteAccount,
  reauthenticateDeletionWithEmail,
  reauthenticateDeletionWithGoogle,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";

export type DeletionMessage =
  | "apple"
  | "appleUnavailable"
  | "reauth"
  | "reauthFailed"
  | "wrongAccount"
  | "sessionChanged"
  | "expired"
  | "partial"
  | "failed"
  | "deleted";
export type DeletionState = {
  phase:
    | "idle"
    | "warning"
    | "confirm"
    | "reauth"
    | "busy"
    | "done"
    | "blocked";
  message?: DeletionMessage;
};

/** One panel lifetime, one captured identity. Subscription detects even A→B→A
 * and logout→login between renders. Never persist passwords or credentials.
 */
export function createAccountDeletion(
  onChange: (state: DeletionState) => void,
) {
  const origin = useAuthStore.getState();
  const user = origin.user;
  let state: DeletionState = { phase: "idle" };
  let alive = true;
  let identityCurrent = Boolean(user?._id && origin.session?.accessToken);
  let generation = 0;
  let ownCommit = false;
  let loginInFlight = false;
  let deletionInFlight = false;
  let abort: AbortController | undefined;
  const emit = (next: DeletionState) => {
    state = next;
    if (alive) onChange(next);
  };
  const unsubscribe = useAuthStore.subscribe((next, previous) => {
    if (ownCommit) return;
    if (
      next.user?._id !== previous.user?._id ||
      next.session !== previous.session
    ) {
      identityCurrent = false;
      generation++;
      abort?.abort();
      emit({ phase: "blocked", message: "sessionChanged" });
    }
  });
  const current = (operation: number) =>
    alive && identityCurrent && operation === generation;
  const clearLocal = () => {
    if (!identityCurrent) return;
    ownCommit = true;
    try {
      const store = useAuthStore.getState();
      store.clearLocalSession();
      identityCurrent = false;
    } finally {
      ownCommit = false;
    }
  };
  const failure = (error: unknown, retried: boolean) => {
    if (error instanceof ApiError) {
      if (error.code === 404 && error.reason === "NOT_FOUND") {
        emit({ phase: "done", message: "deleted" });
        clearLocal();
        return;
      }
      if (error.code === 403 && error.reason === "REAUTH_REQUIRED") {
        emit(
          retried
            ? { phase: "confirm", message: "reauthFailed" }
            : { phase: "reauth", message: "reauth" },
        );
        return;
      }
      if (
        error.code === 403 &&
        (error.reason === "APPLE_AUTHORIZATION_REQUIRED" ||
          error.reason === "APPLE_AUTHORIZATION_INVALID")
      ) {
        emit({ phase: "blocked", message: "apple" });
        return;
      }
      if (error.code === 503 && error.reason === "APPLE_REVOKE_UNAVAILABLE") {
        emit({ phase: "blocked", message: "appleUnavailable" });
        return;
      }
      if (error.code === 401 || error.code === 403) {
        emit({ phase: "blocked", message: "expired" });
        clearLocal();
        return;
      }
      if (error.code === 500) {
        emit({ phase: "confirm", message: "partial" });
        return;
      }
    }
    emit({ phase: "confirm", message: "failed" });
  };
  const requestDeletion = async (
    operation: number,
    retried: boolean,
    accessToken?: string,
  ) => {
    if (!current(operation) || deletionInFlight) return;
    deletionInFlight = true;
    abort = new AbortController();
    emit({ phase: "busy" });
    try {
      const res = await deleteAccount(
        () => current(operation),
        abort.signal,
        accessToken,
      );
      if (!current(operation)) return;
      if (res.code === 200 && res.ok === true) {
        emit({ phase: "done", message: "deleted" });
        clearLocal();
      } else {
        failure(new ApiError(res.message, res.code), retried);
      }
    } catch (error) {
      if (current(operation)) failure(error, retried);
    } finally {
      deletionInFlight = false;
    }
  };
  const reauthenticate = async (
    provider: "local" | "google",
    secret: string,
  ) => {
    if (
      !identityCurrent ||
      !alive ||
      state.phase !== "reauth" ||
      loginInFlight ||
      !secret ||
      !user
    )
      return;
    if (!user.authProviders.includes(provider)) return;
    const operation = ++generation;
    loginInFlight = true;
    emit({ phase: "busy" });
    try {
      const res =
        provider === "local"
          ? await reauthenticateDeletionWithEmail(user.email, secret)
          : await reauthenticateDeletionWithGoogle(secret);
      // Cookie-isolated responses have no global effects to undo.
      if (!current(operation)) return;
      if (!res.ok) {
        emit({ phase: "reauth", message: "reauthFailed" });
        return;
      }
      if (
        !res.data ||
        res.data.user?._id !== user._id ||
        !Array.isArray(res.data.user.authProviders) ||
        typeof res.accessToken !== "string" ||
        !res.accessToken
      ) {
        emit({ phase: "blocked", message: "wrongAccount" });
        return;
      }
      if (res.data.user.authProviders.includes("apple")) {
        emit({ phase: "blocked", message: "apple" });
        return;
      }
      // Fresh bearer belongs only to this single deletion retry.
      await requestDeletion(operation, true, res.accessToken);
    } catch {
      if (current(operation))
        emit({ phase: "reauth", message: "reauthFailed" });
    } finally {
      loginInFlight = false;
    }
  };
  return {
    getState: () => state,
    begin: () => {
      if (
        !alive ||
        !identityCurrent ||
        loginInFlight ||
        deletionInFlight ||
        state.phase !== "idle"
      )
        return;
      emit(
        user?.authProviders.includes("apple")
          ? { phase: "blocked", message: "apple" }
          : { phase: "warning" },
      );
    },
    advance: () => {
      if (alive && identityCurrent && state.phase === "warning")
        emit({ phase: "confirm" });
    },
    confirm: async () => {
      if (
        !alive ||
        !identityCurrent ||
        loginInFlight ||
        deletionInFlight ||
        state.phase !== "confirm"
      )
        return;
      await requestDeletion(++generation, false);
    },
    reauthenticate,
    reauthError: () => {
      if (alive && identityCurrent && state.phase === "reauth")
        emit({ phase: "reauth", message: "reauthFailed" });
    },
    cancel: () => {
      generation++;
      abort?.abort();
      emit(
        identityCurrent
          ? { phase: "idle" }
          : { phase: "blocked", message: "sessionChanged" },
      );
    },
    dispose: () => {
      alive = false;
      generation++;
      abort?.abort();
      unsubscribe();
    },
  };
}
