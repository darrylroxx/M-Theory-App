/**
 * The idea on screen, told apart from every other one: by its id once it is saved, and before that by the id it was
 * started with (`draft`, a new one for each new idea). The track view's own copy of `./openidea`.
 */
import type { App5State } from "./app5";

export const ideaKey5 = (s: Pick<App5State, "ideaId" | "draft">): string | null => s.ideaId ?? s.draft ?? null;

/**
 * The idea on screen under another id: saved for the first time, or gone from the library while open (it stays on
 * screen, not saved). It is still the same idea: its song, its undo steps and what is open stay as they are. The same
 * state comes back when nothing changes.
 */
export function reidea5(s: App5State, ideaId: string | null, draft = s.draft): App5State {
  return (s.ideaId ?? null) === ideaId && s.draft === draft ? s : { ...s, ideaId, draft };
}
