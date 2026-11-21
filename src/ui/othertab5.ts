/**
 * The app open in more than one browser tab: they share one place in storage, and each writes all it has there on every
 * change. What is shared by every idea (the library, what was deleted from it, your own rhythms, kits, sounds and chord
 * shapes) is taken in from what another tab wrote, so a tab that has not seen an idea saved in another never writes it
 * away. The track view's own copy of `./othertab`, for ideas of tracks and clips.
 */
import { reviveUserKits } from "../audio/beats";
import { reviveUserSounds } from "../audio/sounds";
import type { RemoteIdea } from "../song/library";
import { ideaTime5, mergeIdeas5 } from "../timeline/library5";
import type { App5State } from "./app5";
import { reidea5 } from "./openidea5";

/** What another tab wrote, as read back from storage (anything in it may be missing or wrong). */
type Theirs = { saved?: unknown; tombs?: unknown; myBeats?: unknown; myKits?: unknown; mySounds?: unknown; shapes?: unknown };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const sameRecord = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

/** A list of things with ids: theirs as they left it ("theirs": they wrote last), or this tab's with theirs added ("both"). */
function list<T extends { id: string }>(mine: T[], theirs: T[], how: "theirs" | "both"): T[] {
  const next = how === "theirs" ? theirs : [...mine, ...theirs.filter((x) => !mine.some((y) => y.id === x.id))];
  return same(next, mine) ? mine : next;
}

/**
 * This tab's state with another tab's library taken in. The ideas are merged as with the cloud: the newer copy of each
 * wins, and a deletion wins over any older copy (the idea open here, if it was deleted there, stays on screen, not
 * saved). A backup entry is an idea like any other here, so two tabs never hold it twice, and one deleted in either
 * stays deleted. `how`: "theirs" when it is what the other tab has just written; "both" when this tab has changes the
 * other has not seen either. Returns `s` itself when there is nothing new.
 */
export function joinOtherTab5(s: App5State, theirs: Theirs | null | undefined, how: "theirs" | "both", draft: () => string): App5State {
  if (!theirs || typeof theirs !== "object") return s;
  const tombs: Record<string, number> = {};
  if (theirs.tombs && typeof theirs.tombs === "object") for (const [id, at] of Object.entries(theirs.tombs as Record<string, unknown>)) if (typeof at === "number") tombs[id] = at;
  const remote: RemoteIdea[] = [];
  for (const raw of Array.isArray(theirs.saved) ? theirs.saved : []) {
    const i = raw as { id?: unknown; updatedAt?: unknown; savedAt?: unknown } | null;
    if (!i || typeof i.id !== "string") continue;
    const at = Number(i.updatedAt ?? i.savedAt) || 0;
    const mine = s.saved.find((x) => x.id === i.id);
    // (only a copy newer than this tab's is read: the rest would be passed over)
    if (!mine || ideaTime5(mine) < at) remote.push({ id: i.id, updatedAt: at, json: JSON.stringify(raw) });
  }
  for (const [id, at] of Object.entries(tombs)) if (!remote.some((r) => r.id === id)) remote.push({ id, updatedAt: at, deleted: true });
  const m = mergeIdeas5(s.saved, s.tombs ?? {}, remote);
  const keepIdeas = m.ideas.length === s.saved.length && m.ideas.every((i) => s.saved.some((x) => x === i));
  const saved = keepIdeas ? s.saved : m.ideas;
  const deadSame = same(m.tombs, s.tombs ?? {});
  const myBeats = Array.isArray(theirs.myBeats) ? list(s.myBeats, theirs.myBeats.filter((b) => b && typeof b.id === "string"), how) : s.myBeats;
  const myKits = Array.isArray(theirs.myKits) ? list(s.myKits, reviveUserKits(theirs.myKits), how) : s.myKits;
  const mySounds = Array.isArray(theirs.mySounds) ? list(s.mySounds, reviveUserSounds(theirs.mySounds), how) : s.mySounds;
  const theirShapes = theirs.shapes && typeof theirs.shapes === "object" ? (theirs.shapes as Record<string, string>) : {};
  const shapes0 = how === "theirs" ? { ...s.shapes, ...theirShapes } : { ...theirShapes, ...s.shapes };
  const shapes = sameRecord(shapes0, s.shapes) ? s.shapes : shapes0;
  if (keepIdeas && deadSame && myBeats === s.myBeats && myKits === s.myKits && mySounds === s.mySounds && shapes === s.shapes) return s;
  const gone = !!s.ideaId && !saved.some((i) => i.id === s.ideaId);
  return { ...(gone ? reidea5(s, null, draft()) : s), saved, tombs: deadSame ? s.tombs : m.tombs, myBeats, myKits, mySounds, shapes };
}
