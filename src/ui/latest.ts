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
