/**
 * Something started that finishes later (a song file read, a piano loaded before ▶): only the
 * last one started may go on when it finishes, and none once it is called off. Without this, a
 * slow one finishing after a quicker, later one, or after the painter or the player changed
 * their mind, would undo what they did since.
 */
export function lastOnly(): { begin: () => () => boolean; cancel: () => void } {
  let n = 0;
  return {
    /** Start one: what it returns says, when it finishes, whether it is still wanted. */
    begin: () => {
      const mine = ++n;
      return () => mine === n;
    },
    /** Call off whatever is under way. */
    cancel: () => void n++,
  };
}

/** The same, for each of several things on its own (each track's change of instrument): one key's last start does not call off another's. */
export function lastOnlyEach(): { begin: (key: string) => () => boolean } {
  const each = new Map<string, ReturnType<typeof lastOnly>>();
  return {
    begin: (key) => {
      let l = each.get(key);
      if (!l) each.set(key, (l = lastOnly()));
      return l.begin();
    },
  };
}
