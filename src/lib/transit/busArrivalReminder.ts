import {
  TRACKING_FRESH_MS,
  type TrackingSnapshot,
} from "@/lib/transit/busPanelTracking";

/** Permission is initiated only by enable(), called from a user click. */
export function createBusArrivalReminder(options: {
  requestPermission: () => Promise<unknown>;
  fire: () => void;
  now?: () => number;
}) {
  let generation = 0;
  let enabled = false;
  let fired = false;
  return {
    enable: () => {
      const epoch = ++generation;
      enabled = true;
      fired = false;
      // Permission completion must never re-enable cancelled/replaced intent.
      void options
        .requestPermission()
        .catch(() => undefined)
        .then(() => {
          if (epoch !== generation) return;
        });
    },
    cancel: () => {
      generation++;
      enabled = false;
      fired = false;
    },
    observe: (snapshot: TrackingSnapshot | null, visible: boolean) => {
      if (!enabled || fired || !visible || !snapshot) return false;
      const age = (options.now ?? Date.now)() - snapshot.receivedAt;
      const eta = snapshot.arrival?.estimateMinutes;
      if (
        age < 0 ||
        age > TRACKING_FRESH_MS ||
        typeof eta !== "number" ||
        !Number.isFinite(eta) ||
        eta < 0 ||
        eta > 3
      )
        return false;
      fired = true;
      enabled = false;
      options.fire();
      return true;
    },
  };
}
