import { useSyncExternalStore } from "react";

/**
 * Is the singer hearing themselves through the app's effects right now? The Vocals page says
 * so, and the tabs show it, so it is clear the mic stays live on every page.
 */
let live = false;
const subs = new Set<() => void>();
export function setLive(on: boolean): void {
  if (on === live) return;
  live = on;
  subs.forEach((f) => f());
}
export function useLive(): boolean {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => live,
    () => false,
  );
}
