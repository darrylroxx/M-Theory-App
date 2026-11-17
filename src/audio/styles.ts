/**
 * The library of playing styles. The symbols are explained in patterns.ts.
 *
 * `four` is written for a bar of four beats and `three` for a bar of three; a style with only
 * `three` is a waltz. `div` is the grid: 2 = eighth notes, 4 = sixteenths, 3 = triplets (so twelve
 * steps of a triplet style are one bar of 12/8, or two bars of 6/8).
 *
 * These are the patterns guitar and harp teachers hand out, collected from the lesson sites and
 * method books listed in the README; none is named after a player or a song.
 */
export type StyleGroup = "simple" | "strum" | "bass" | "drive" | "groove" | "latin" | "swing" | "waltz" | "pick" | "arp" | "harp";

export interface Style {
  id: string;
  name: string;
  group: StyleGroup;
  hint: string;
  /** steps in a beat */
  div: 2 | 3 | 4;
  /** one string of symbols per bar of four beats */
  four?: string[];
  /** the same for a bar of three beats */
  three?: string[];
  /** how far the off-beats lean back: 0 straight, 0.6 a light swing, 1 a full shuffle */
  swing?: number;
  /** seconds from one string to the next in a strum */
  spread?: number;
  /** the same for a rolled chord */
  roll?: number;
  /** what is played when a chord starts where the pattern is silent ("" = nothing: the silence is the style) */
  entry?: string;
}

export const STYLE_GROUPS: { id: StyleGroup; name: string }[] = [
  { id: "simple", name: "Simple" },
  { id: "strum", name: "Strumming" },
  { id: "bass", name: "Bass & strum" },
  { id: "pick", name: "Fingerpicking" },
  { id: "arp", name: "Arpeggios" },
  { id: "harp", name: "Harp" },
  { id: "drive", name: "Rock" },
  { id: "groove", name: "Funk & reggae" },
  { id: "latin", name: "Latin" },
  { id: "swing", name: "Shuffle & 6/8" },
  { id: "waltz", name: "Waltz" },
];

/** Repeat a one-beat or half-bar cell to fill a bar. */
const x = (cell: string, times: number) => Array(times).fill(cell).join(" ");

export const STYLES: Style[] = [
  // ── Simple: for hearing the harmony ──
  { id: "ring", name: "Let ring", group: "simple", hint: "One rolled chord, left to ring. Best for hearing the harmony.", div: 2, four: ["R . . . . . . ."], three: ["R . . . . ."], entry: "R" },
  { id: "block", name: "Plucked", group: "simple", hint: "All the notes at once, like a pianist's chord.", div: 2, four: ["T . . . . . . ."], three: ["T . . . . ."], entry: "T" },
  { id: "half", name: "Half notes", group: "simple", hint: "Two slow strums a bar.", div: 2, spread: 0.012, four: ["D . . . D< . . ."], three: ["D . . . D< ."] },
  { id: "quarters", name: "On the beat", group: "simple", hint: "A down-strum on every beat.", div: 2, spread: 0.01, four: ["D . D< . D . D< ."], three: ["D . D< . D< ."] },
  { id: "eighths", name: "Down-up", group: "simple", hint: "Straight eighth notes, down and up.", div: 2, four: ["D U D U D U D U"], three: ["D U D U D U"] },

  // ── Strumming ──
  { id: "strum", name: "Island strum", group: "strum", hint: "Down, down-up, up-down-up. The most played strum there is.", div: 2, four: ["D . D U . U D U"], three: ["D . D U D U"] },
  { id: "campfire", name: "Campfire", group: "strum", hint: "Down, down-up, down, down-up.", div: 2, four: ["D . D U D . D U"], three: ["D . D U D ."] },
  { id: "folk", name: "Folk strum", group: "strum", hint: "A long first beat, then steady down-ups.", div: 2, four: ["D . D U D U D U"], three: ["D . D U D U"] },
  { id: "softpop", name: "Soft pop", group: "strum", hint: "Easy quarter notes with a lift into the next bar.", div: 2, four: ["D . D< . D> . D U"] },
  { id: "short", name: "Island, short", group: "strum", hint: "The island strum with a breath at the end of the bar.", div: 2, four: ["D . D U . U D ."] },
  { id: "held", name: "Held three", group: "strum", hint: "Sparse and open: beat three is left to ring.", div: 2, four: ["D . D . . U D U"] },
  { id: "busy", name: "Busy pop", group: "strum", hint: "Almost every eighth note, skipping only beat three.", div: 2, four: ["D U D U . U D U"] },
  { id: "ballad16", name: "Slow ballad", group: "strum", hint: "The island strum twice as fast, for slow songs.", div: 4, four: [x("D . D U . U D U", 2)], three: ["D . D U . U D U D . D U"] },
  { id: "pop16", name: "Sixteenth pop", group: "strum", hint: "Down, down-up, then a run of sixteenths.", div: 4, four: [x("D . D U D U D U", 2)] },
  { id: "skip16", name: "Skipping sixteenths", group: "strum", hint: "Constant sixteenths with the “and” left out.", div: 4, four: [x("D U . U", 4)] },
  { id: "chuck", name: "Backbeat chuck", group: "strum", hint: "A muted slap on beats two and four, like a snare.", div: 2, four: ["D . X . D U X ."] },
  { id: "islandchuck", name: "Island with chucks", group: "strum", hint: "The island strum with a slap on two and four.", div: 2, four: ["D . X U . U X U"] },
  { id: "chuck8", name: "Chucked eighths", group: "strum", hint: "Steady down-ups, slapped on two and four.", div: 2, four: ["D U X U D U X U"] },

  // ── Bass and strum ──
  { id: "boomchick", name: "Boom-chick", group: "bass", hint: "Bass note, strum, other bass note, strum. Country and folk.", div: 2, four: ["p . H . q . H ."], three: ["p . H . H .", "q . H . H ."] },
  { id: "boomchicka", name: "Boom-chick-a", group: "bass", hint: "Bass note, then a down-up brush.", div: 2, four: ["p . H h q . H h"], three: ["p . H h H h", "q . H h H h"] },
  { id: "bluegrass", name: "Bluegrass", group: "bass", hint: "Boom-chick with a hard accent on the strum.", div: 2, four: ["p . H> . q . H> ."] },
  { id: "train", name: "Train", group: "bass", hint: "A clipped, chugging boom-chick-a.", div: 2, four: ["p . S s q . S s"] },
  { id: "bolero", name: "Bolero", group: "bass", hint: "A slow bass note answered late in the beat.", div: 2, four: ["p . . H q . . H"] },

  // ── Fingerpicking ──
  { id: "travis", name: "Alternating thumb", group: "pick", hint: "The thumb keeps the beat on two bass strings while the fingers fill in. Folk fingerstyle.", div: 2, four: ["p . q m p i q ."], three: ["p . q m p i"] },
  { id: "insideout", name: "Thumb, inside-out", group: "pick", hint: "The same steady thumb, the fingers the other way round.", div: 2, four: ["p . q i p m q ."], three: ["p . q i p m"] },
  { id: "pinch", name: "Pinch", group: "pick", hint: "Thumb and finger together on beat one, then a rolling fill.", div: 2, four: ["pm . q i p m q i"], three: ["pm . q i p m"] },
  { id: "doublepinch", name: "Double pinch", group: "pick", hint: "A pinch on beats one and three.", div: 2, four: ["pm . q i pm . q i"] },
  { id: "thumbfinger", name: "Thumb and finger", group: "pick", hint: "Thumb, finger, thumb, finger: even and gentle.", div: 2, four: ["p i q m p i q m"], three: ["p i q m p i"] },
  { id: "threebass", name: "Walking thumb", group: "pick", hint: "The thumb walks over three bass strings.", div: 2, four: ["p . q m r i q ."] },
  { id: "thumb", name: "Thumb only", group: "pick", hint: "Just the two bass notes, one a beat.", div: 2, four: ["p . q . p . q ."], three: ["p . q . q ."] },
  { id: "folkarp", name: "Folk arpeggio", group: "pick", hint: "Bass note, then three fingers up, on two bass strings in turn.", div: 2, four: ["p i m a q i m a"], three: ["p i m a m i"] },
  { id: "forward", name: "Forward roll", group: "pick", hint: "Thumb-index-middle, three-three-two, borrowed from the banjo.", div: 2, four: ["p i m p i m p m"] },
  { id: "backward", name: "Backward roll", group: "pick", hint: "The banjo roll falling from the top.", div: 2, four: ["m i p m i p m i"], entry: "p" },
  { id: "fwdrev", name: "Forward and back", group: "pick", hint: "A roll up, then back down again.", div: 2, four: ["p i m q m i p m"] },
  { id: "rocking", name: "Rocking", group: "pick", hint: "Low, high, middle, high: the keyboard player's broken chord.", div: 2, four: ["p m i m p m i m"], three: ["p m i m i m"] },
  { id: "frail", name: "Frailing", group: "pick", hint: "A note, a brush and the thumb: bum-ditty.", div: 2, four: ["a . h p a . h p"] },
  { id: "pairs", name: "Pairs", group: "pick", hint: "Two notes at a time, low pair then high pair.", div: 2, four: ["pi . ma . pi . ma ."], three: ["pi . ma . ma ."] },
  { id: "bassblock", name: "Bass and chord", group: "pick", hint: "A bass note answered by the three top notes together.", div: 2, four: ["p . ima . q . ima ."], three: ["p . ima . ima ."] },

  // ── Arpeggios ──
  { id: "arpeggio", name: "Up and down", group: "arp", hint: "Every note of the chord, low to high and back. Dreamy.", div: 2, four: ["1 2 3 4 5 6 5 4"], three: ["1 2 3 4 3 2"] },
  { id: "pima", name: "Rolling up", group: "arp", hint: "Thumb and three fingers, rising, in sixteenths.", div: 4, four: [x("p i m a", 4)], three: [x("p i m a", 3)] },
  { id: "pami", name: "Rolling down", group: "arp", hint: "Bass note, then the fingers falling from the top.", div: 4, four: [x("p a m i", 4)], three: [x("p a m i", 3)] },
  { id: "pimi", name: "Ripple", group: "arp", hint: "Thumb, index, middle, index: a close, even ripple.", div: 4, four: [x("p i m i", 4)], three: [x("p i m i", 3)] },
  { id: "wave", name: "Wave", group: "arp", hint: "Eight notes rising to the top string and falling back.", div: 4, four: [x("p i m i a i m i", 2)] },
  { id: "six", name: "Flowing six", group: "arp", hint: "Six notes up and back to every two beats.", div: 3, four: [x("p i m a m i", 2)], three: ["p i m a m i p i m"] },
  { id: "crossing", name: "Crossing six", group: "arp", hint: "Six notes with the fingers crossing over each other.", div: 3, four: [x("p m i a m i", 2)] },
  { id: "triplets", name: "Triplets", group: "arp", hint: "Thumb, index, middle on every beat.", div: 3, four: [x("p i m", 4)], three: [x("p i m", 3)] },
  { id: "tripletsdown", name: "Triplets, falling", group: "arp", hint: "Thumb, then the top notes falling, on every beat.", div: 3, four: [x("p a m", 4)], three: [x("p a m", 3)] },
  { id: "slowarp", name: "Slow arpeggio", group: "arp", hint: "One note at a time, rising, with room to breathe.", div: 2, four: ["p i m a m i m a"], three: ["p i m a m i"] },

  // ── Harp ──
  { id: "slowroll", name: "Slow roll", group: "harp", hint: "The chord spread out leisurely from the bottom.", div: 2, roll: 0.08, four: ["R . . . . . . ."], three: ["R . . . . ."], entry: "R" },
  { id: "rolldown", name: "Falling roll", group: "harp", hint: "Rolled from the top note down: a harpist's phrase ending.", div: 2, four: ["L . . . . . . ."], three: ["L . . . . ."], entry: "L" },
  { id: "rolltwice", name: "Up, then down", group: "harp", hint: "Rolled up on one, answered down on three.", div: 2, four: ["R . . . L< . . ."], three: ["R . . . L< ."], entry: "R" },
  { id: "broken", name: "Broken chord", group: "harp", hint: "Root, fifth, octave and back: the harp's everyday accompaniment.", div: 2, four: ["1 2 3 2 1 2 3 2"], three: ["1 2 3 2 3 2"] },
  { id: "extended", name: "Wide arpeggio", group: "harp", hint: "The broken chord reaching up past the octave.", div: 2, four: ["1 2 3 4 5 4 3 2"], three: ["1 2 3 4 3 2"] },
  { id: "roving", name: "Roving thumb", group: "harp", hint: "Root and fifth stay put while the top note wanders.", div: 4, four: ["1 2 3 . 1 2 4 . 1 2 5 . 1 2 4 ."], three: ["1 2 3 . 1 2 4 . 1 2 5 ."] },
  { id: "cascade", name: "Cascade", group: "harp", hint: "Up through two octaves and back down, hand over hand.", div: 4, four: ["1 2 3 4 5 6 7 8 9 8 7 6 5 4 3 2"], three: ["1 2 3 4 5 6 7 6 5 4 3 2"] },
  { id: "gliss", name: "Glissando", group: "harp", hint: "A sweep across the strings into every bar.", div: 2, four: ["G . . . . . . ."], three: ["G . . . . ."], entry: "R" },
  { id: "glisstwice", name: "Sweep and return", group: "harp", hint: "A sweep up, then a sweep back down.", div: 2, four: ["G . . . g< . . ."], three: ["G . . . g< ."], entry: "R" },
  { id: "whisper", name: "Whisper", group: "harp", hint: "A soft, quick murmur on the upper notes over a held bass.", div: 4, four: [x("p m< a< m< i< m< a< m<", 2)], three: ["p m< a< m< i< m< a< m< i< m< a< m<"] },

  // ── Rock ──
  { id: "pulse", name: "Muted eighths", group: "drive", hint: "Palm-muted eighth notes on the low strings. Driving.", div: 2, four: ["K> K K K K> K K K"], three: ["K> K K K K K"], entry: "K" },
  { id: "downs", name: "All down", group: "drive", hint: "Eight down-strums a bar, no ups.", div: 2, four: ["D D< D D< D D< D D<"], three: ["D D< D D< D D<"] },
  { id: "drive", name: "Backbeat drive", group: "drive", hint: "Steady down-strums that lean on two and four.", div: 2, four: ["D< D< D> D< D< D< D> D<"] },
  { id: "push332", name: "Three-three-two", group: "drive", hint: "Eighth notes accented in groups of three, three and two.", div: 2, four: ["D> D< D< D> D< D< D> D<"] },
  { id: "gallop", name: "Gallop", group: "drive", hint: "One long, two short, on every beat.", div: 4, four: [x("K . K K", 4)], three: [x("K . K K", 3)], entry: "K" },
  { id: "revgallop", name: "Reverse gallop", group: "drive", hint: "Two short, one long, on every beat.", div: 4, four: [x("K K K .", 4)], three: [x("K K K .", 3)], entry: "K" },
  { id: "stabs", name: "Stabs", group: "drive", hint: "Short, hard chords on the beat.", div: 2, four: ["S . S . S . S ."], three: ["S . S . S ."], entry: "S" },

  // ── Funk and reggae ──
  { id: "funk", name: "Funk sixteenths", group: "groove", hint: "Tight chords on the down-strokes, muted scratches between.", div: 4, four: [x("S X S X", 4)], entry: "S" },
  { id: "funksync", name: "Funk, syncopated", group: "groove", hint: "A bed of scratches with the chord jabbing through.", div: 4, four: ["S> X S> X X X X s> X X S> X X X X s>"], entry: "S" },
  { id: "disco", name: "Disco", group: "groove", hint: "Scratches with the chord on every off-beat.", div: 4, four: [x("X X S> X", 4)], three: [x("X X S> X", 3)], entry: "" },
  { id: "skank", name: "Reggae skank", group: "groove", hint: "Short chops on beats two and four.", div: 2, four: [". . S> . . . S> ."], three: [". . S> . S> ."], entry: "" },
  { id: "chops", name: "Off-beat chops", group: "groove", hint: "A short up-stroke on every “and”.", div: 2, four: [". s . s . s . s"], three: [". s . s . s"], entry: "" },
  { id: "doublechop", name: "Double chop", group: "groove", hint: "A quick down-up on two and four.", div: 2, four: [". . S s . . S s"], three: [". . S s S s"], entry: "" },
  { id: "ska", name: "Ska", group: "groove", hint: "Muted on the beat, a bright up-stroke off it. Fast.", div: 2, four: ["X s> X s> X s> X s>"], three: ["X s> X s> X s>"], entry: "" },
  { id: "onedrop", name: "One drop", group: "groove", hint: "One chop a bar, on beat three.", div: 2, four: [". . . . S> . . ."], three: [". . S> . . ."], entry: "" },
  { id: "offchuck", name: "Chuck and up", group: "groove", hint: "A slap and an up-stroke on two and four.", div: 2, four: [". . X U . . X U"], three: [". . X U X U"], entry: "" },

  // ── Latin ──
  { id: "bossa", name: "Bossa nova", group: "latin", hint: "Thumb on one and three, the chord plucked around it. Two bars.", div: 2, four: ["pima . . ima q . ima .", "p . ima . q ima . ."] },
  { id: "bossarev", name: "Bossa, reversed", group: "latin", hint: "The same two bars the other way round.", div: 2, four: ["p . ima . q ima . .", "pima . . ima q . ima ."] },
  { id: "samba", name: "Samba", group: "latin", hint: "The bossa pattern at double speed.", div: 4, four: ["pima . . ima q . ima . p . ima . q ima . ."] },
  { id: "rumba", name: "Rumba", group: "latin", hint: "A fiery three-three-two strum with a slap in the middle.", div: 2, four: ["D> U D D> X U D> U"] },
  { id: "rumbaeasy", name: "Easy rumba", group: "latin", hint: "Down, up, down, flick, pause, up, down, up.", div: 2, four: ["D U D D . U D U"] },
  { id: "tresillo", name: "Tresillo", group: "latin", hint: "Three hits spread over the bar: three, three, two.", div: 2, four: ["D> . . D> . . D> ."] },
  { id: "tresfill", name: "Tresillo, filled", group: "latin", hint: "The same three accents with soft strums between them.", div: 2, four: ["D> U< D< U> D< U< D> U<"] },
  { id: "habanera", name: "Habanera", group: "latin", hint: "Long, short, long, long: the tango rhythm.", div: 2, four: ["D . . D D . D ."] },
  { id: "cinquillo", name: "Cinquillo", group: "latin", hint: "Five strums a bar: long-short-long-short-long.", div: 2, four: ["D . D D . D D ."] },
  { id: "clave", name: "Son clave", group: "latin", hint: "Three hits, then two. Two bars.", div: 2, four: ["D . . D . . D .", ". . D . D . . ."], entry: "" },

  // ── Shuffle and 6/8 ──
  { id: "shuffle", name: "Shuffle", group: "swing", hint: "A long down and a short up on every beat.", div: 3, four: [x("D . U", 4)], three: [x("D . U", 3)] },
  { id: "shufflemute", name: "Blues shuffle", group: "swing", hint: "A down-stroke and a muted skip on every beat.", div: 3, four: [x("D . X", 4)], three: [x("D . X", 3)] },
  { id: "swungisland", name: "Swung island", group: "swing", hint: "The island strum with a lazy swing.", div: 3, four: ["D . . D . U . . U D . U"] },
  { id: "lightswing", name: "Light swing", group: "swing", hint: "Down-ups that lean back just a little.", div: 2, swing: 0.6, four: ["D . D U D U D U"], three: ["D . D U D U"] },
  { id: "slowblues", name: "Slow 12/8", group: "swing", hint: "Three strums to every beat, the first one leaned on.", div: 3, four: [x("D> D< D<", 4)], three: [x("D> D< D<", 3)] },
  { id: "doowop", name: "12/8 backbeat", group: "swing", hint: "Twelve gentle strums with a snap on two and four.", div: 3, four: ["D D< D< D> D< D< D D< D< D> D< D<"] },
  { id: "six8", name: "6/8 pulse", group: "swing", hint: "One slow strum on each of the two big beats.", div: 3, spread: 0.01, four: [x("D> . . D< . .", 2)], three: ["D> . . D< . . D< . ."] },
  { id: "six8full", name: "6/8 down-up-up", group: "swing", hint: "Down, up, up: a rolling six.", div: 3, four: [x("D U U", 4)], three: [x("D U U", 3)] },
  { id: "jig", name: "Jig", group: "swing", hint: "Down, down, up: a dancing six.", div: 3, four: [x("D D< U", 4)], three: [x("D D< U", 3)] },
  { id: "ballad68", name: "6/8 ballad", group: "swing", hint: "The classic slow broken chord: six notes up and back.", div: 3, four: [x("p> i m a> m i", 2)], three: ["p> i m a> m i p i m"] },

  // ── Waltz ──
  { id: "waltz", name: "Waltz", group: "waltz", hint: "Three down-strums, the first the strongest.", div: 2, three: ["D . D< . D< ."] },
  { id: "waltzswing", name: "Waltz, down-ups", group: "waltz", hint: "Down, down-up, down-up.", div: 2, three: ["D . D U D U"] },
  { id: "folkwaltz", name: "Folk waltz", group: "waltz", hint: "Six even strums, down and up.", div: 2, three: ["D U D< U D< U"] },
  { id: "oompah", name: "Bass-chick-chick", group: "waltz", hint: "A bass note and two strums; the bass changes every bar.", div: 2, three: ["p . H . H .", "q . H . H ."] },
  { id: "waltzups", name: "Bass and brushes", group: "waltz", hint: "A bass note, then down-up brushes.", div: 2, three: ["p . H h H h", "q . H h H h"] },
  { id: "waltzarp", name: "Waltz arpeggio", group: "waltz", hint: "Six picked notes with the thumb on one and the middle of the bar.", div: 2, three: ["p i m q i a"] },
  { id: "waltzsix", name: "Up and back", group: "waltz", hint: "Thumb and three fingers up, two back.", div: 2, three: ["p i m a m i"] },
  { id: "waltzpluck", name: "Waltz pluck", group: "waltz", hint: "A bass note, then the chord plucked twice.", div: 2, three: ["p . ima . ima ."] },
];
