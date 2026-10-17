/**
 * Relative to the fitted close-up on this viewport: 0.9 zoom levels reduce
 * map scale by about 2x (2 ** 0.9), on both desktop and mobile.
 */
export function getIndoorExitZoom(entryZoom: number): number {
  return entryZoom - 0.9;
}

export interface IndoorExitState {
  zoom: number;
  /** Captured only after the initial indoor fit has finished. */
  entryZoom: number | null;
  entering: boolean;
  /** Explicit user dimension state; entry sets this to true before mounting. */
  is3D: boolean;
}

/**
 * Called only while indoor is open. This predicate has no entry/re-entry
 * action: zooming back in after leaving never opens the building by itself.
 */
export function shouldLeaveIndoor({
  zoom,
  entryZoom,
  entering,
  is3D,
}: IndoorExitState): boolean {
  if (!is3D) return true;
  if (
    entering ||
    entryZoom === null ||
    !Number.isFinite(entryZoom) ||
    !Number.isFinite(zoom)
  )
    return false;
  return zoom <= getIndoorExitZoom(entryZoom);
}
