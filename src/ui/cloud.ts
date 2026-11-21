/**
 * Keeps the idea library in the viewer's Claude account when the app runs as a
 * claude.ai artifact, so ideas follow you from one device to the next.
 * Everywhere else (GitHub Pages, local dev) there is no cloud and the library
 * simply lives in this browser.
 *
 * Each idea is one small document in the viewer's private area of the
 * artifact's database (`data/users/<viewer id>/idea_<id>`), which nobody else
 * can read.
 */
import type { RemoteIdea } from "../song/library";

type Doc = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };
type DocRef = { set(data: Record<string, unknown>): Promise<void> };
type Collection = { doc(id: string): DocRef; get(): Promise<{ docs: Doc[] }> };
type Db = { collection(path: string): Collection };
type User = { id(): Promise<string | null> };
type Permissions = { state(name: string): Promise<string> };
type Host = { use(name: string): Promise<unknown> };

const host = (): Host | null => (typeof window !== "undefined" ? ((window as unknown as { claude?: Host }).claude ?? null) : null);

export type CloudStatus = "local" | "connecting" | "synced" | "error";

export interface Cloud {
  list(): Promise<RemoteIdea[]>;
  put(idea: RemoteIdea): Promise<void>;
}

const within = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

/** Is there a cloud at all, and may we use it without asking the viewer? */
export async function cloudReady(): Promise<"granted" | "ask" | "none"> {
  const h = host();
  if (!h?.use) return "none";
  const perms = (await h.use("permissions").catch(() => null)) as Permissions | null;
  const state = perms ? await perms.state("db").catch(() => "unavailable") : "unavailable";
  return state === "granted" ? "granted" : state === "prompt" ? "ask" : "none";
}

/**
 * Connect to the viewer's private store. Resolves null when there is none (the first call may ask the viewer).
 * `prefix`: which documents are the library's (the ideas of the track view are kept under a prefix of their own, so a
 * build from before it can never open or overwrite them).
 */
export async function connectCloud(prefix = "idea_"): Promise<Cloud | null> {
  const h = host();
  if (!h?.use) return null;
  const [db, user] = (await Promise.all([h.use("db").catch(() => null), h.use("user").catch(() => null)])) as [Db | null, User | null];
  if (!db || !user) return null;
  const me = await user.id().catch(() => null);
  if (!me) return null;
  const col = db.collection(`data/users/${me}`);
  return {
    async list() {
      const snap = await within(col.get(), 10000);
      const out: RemoteIdea[] = [];
      for (const d of snap.docs) {
        const x = d.data();
        if (!d.id.startsWith(prefix) || !x) continue;
        out.push({ id: d.id.slice(prefix.length), updatedAt: Number(x.updatedAt) || 0, deleted: x.deleted === true, json: typeof x.json === "string" ? x.json : undefined });
      }
      return out;
    },
    put(idea) {
      const body: Record<string, unknown> = { updatedAt: idea.updatedAt, deleted: !!idea.deleted };
      if (idea.json) body.json = idea.json;
      return within(col.doc(`${prefix}${idea.id}`).set(body), 10000);
    },
  };
}
