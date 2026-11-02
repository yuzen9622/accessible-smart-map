let latest: Promise<boolean> = Promise.resolve(true);

/**
 * Remembers whether the latest AI plan's indoor leg attached. Every applied
 * plan registers here, so a plan without a venue settles at once.
 */
export function trackAiVenueLoad(load: Promise<boolean>): void {
  latest = load.catch(() => false);
}

/** Whether the latest plan's indoor leg is attached, once it has settled. */
export async function aiVenueLoaded(): Promise<boolean> {
  let current: Promise<boolean>;
  let attached: boolean;
  do {
    current = latest;
    attached = await current;
  } while (current !== latest);
  return attached;
}
