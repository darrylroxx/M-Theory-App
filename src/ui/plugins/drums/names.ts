// Plain words for the names the drum windows show. A few drum sounds in the library are still named by another
// maker's model numbers; on screen each is shown by what it sounds like. The sounds' ids, which songs store, stay.

/** Each model number, and the plain word shown for it (the same words the three machines of those numbers have). */
const PLAIN: [RegExp, string][] = [
  [/\b808\b/g, "Boom"],
  [/\b909\b/g, "Punch"],
  [/\b707\b/g, "Tight"],
  [/\b606\b/g, "Thin"],
];

/** A name as it is shown: with every model number in it said in a plain word. */
export function plainName(name: string): string {
  let out = name;
  for (const [re, word] of PLAIN) out = out.replace(re, word);
  return out;
}

/** Does a name still carry a model number (three digits standing alone)? */
export const hasModelNumber = (name: string): boolean => /\b\d{3}\b/.test(name);
