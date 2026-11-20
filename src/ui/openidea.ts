/**
 * The idea on screen, told apart from every other one: by its id once it is saved, and before
 * that by the id it was started with (`draft`, a new one for each new idea). Every idea not saved
 * yet has no id, so without the draft one would be taken for the next (and every idea without
 * sections calls its one section ""): a section copied in one would be taken, in the next, for
 * the very section it was copied from.
 */
import type { AppState } from "./state";

export const ideaKey = (s: Pick<AppState, "ideaId" | "draft">): string | null => s.ideaId ?? s.draft ?? null;

/**
 * The idea on screen under another id: saved for the first time, or gone from the library while
 * open (it stays on screen, not saved). It is still the same idea, so a section copied from it is
 * still its own.
 */
export function reidea(s: AppState, ideaId: string | null, draft = s.draft): AppState {
  const from = ideaKey(s);
  const next: AppState = { ...s, ideaId, draft };
  const to = ideaKey(next);
  const sec = s.clip?.section;
  return sec && from !== to && sec.idea === from ? { ...next, clip: { ...s.clip, section: { ...sec, idea: to } } } : next;
}
