import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  atomicStoreUpdates,
  withAtomicNotifications,
} from "../atomicNotifications";

function store() {
  return createStore(withAtomicNotifications(() => ({ value: 0 })));
}
describe("atomic navigation notification boundary", () => {
  it("preserves synchronous updates outside transactions", () => {
    const a = store();
    const observe = vi.fn();
    a.subscribe(observe);
    a.setState({ value: 1 });
    expect(observe).toHaveBeenCalledWith({ value: 1 }, { value: 0 });
  });
  it("coalesces nested commits and reports initial previous state after both stores finish", () => {
    const a = store();
    const b = store();
    const seen: number[][] = [];
    a.subscribe((s, p) => seen.push([s.value, p.value, b.getState().value]));
    atomicStoreUpdates(() => {
      a.setState({ value: 1 });
      atomicStoreUpdates(() => {
        a.setState({ value: 2 });
        b.setState({ value: 2 });
      });
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual([[2, 0, 2]]);
  });
  it("honors unsubscribe during commit and continues notifying after a subscriber throws", () => {
    const a = store();
    const b = store();
    const removed = vi.fn();
    const remaining = vi.fn();
    const off = a.subscribe(removed);
    a.subscribe(() => {
      throw new Error("observer failure");
    });
    b.subscribe(remaining);
    expect(() =>
      atomicStoreUpdates(() => {
        a.setState({ value: 1 });
        b.setState({ value: 1 });
        off();
      }),
    ).toThrow("observer failure");
    expect(removed).not.toHaveBeenCalled();
    expect(remaining).toHaveBeenCalledOnce();
    expect(() => b.setState({ value: 2 })).not.toThrow();
    expect(remaining).toHaveBeenCalledTimes(2);
  });
  it("flushes reentrant transactions without exposing partially updated state", () => {
    const a = store();
    const b = store();
    const seen: number[][] = [];
    a.subscribe((s) => {
      if (s.value === 1)
        atomicStoreUpdates(() => {
          a.setState({ value: 2 });
          b.setState({ value: 2 });
        });
    });
    b.subscribe((s) => seen.push([a.getState().value, s.value]));
    atomicStoreUpdates(() => {
      a.setState({ value: 1 });
      b.setState({ value: 1 });
    });
    expect(seen).toEqual([[2, 2]]);
  });
});
