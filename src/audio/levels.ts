/** Input levels as the interface shows them. */

/** The interface's own meter colours: green from −24 dBFS, amber from −6, red at 0 (as its gain halos). */
export const haloOf = (db: number): "off" | "green" | "amber" | "red" => (db >= -0.5 ? "red" : db >= -6 ? "amber" : db >= -24 ? "green" : "off");
/** A sample level (0..1) in dB below full scale. */
export const dbOf = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
/** Where a level sits on a meter that shows −60 to 0 dBFS (0..1). */
export const meterPos = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));
