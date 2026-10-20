import type { StateCreator } from "zustand";

let depth = 0;
let flushing = false;
const pending = new Map<object, () => void>();

/** A synchronous commit boundary for the map/navigation pair, including raw subscribers. */
export function atomicStoreUpdates(update: () => void): void {
  depth++;
  let failed = false;
  let firstError: unknown;
  try {
    update();
  } catch (error) {
    failed = true;
    firstError = error;
  } finally {
    depth--;
  }
  if (depth === 0 && !flushing) {
    flushing = true;
    try {
      while (pending.size) {
        const entry = pending.entries().next().value;
        if (!entry) break;
        const [key, notify] = entry;
        pending.delete(key);
        try {
          notify();
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
    } finally {
      flushing = false;
    }
  }
  if (failed) throw firstError;
}

/** Install before a bound hook captures api.subscribe; no caller opt-in needed. */
export function withAtomicNotifications<T>(
  createState: StateCreator<T>,
): StateCreator<T> {
  return (set, get, api) => {
    const subscribe = api.subscribe;
    api.subscribe = (listener) => {
      const key = {};
      let active = true;
      const unsubscribe = subscribe((state, previous) => {
        if (depth === 0 && !flushing) {
          listener(state, previous);
          return;
        }
        if (!pending.has(key))
          pending.set(key, () => {
            if (active) listener(get(), previous);
          });
      });
      return () => {
        active = false;
        pending.delete(key);
        unsubscribe();
      };
    };
    return createState(set, get, api);
  };
}
