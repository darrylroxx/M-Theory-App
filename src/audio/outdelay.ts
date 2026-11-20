/**
 * How much later than the audio clock says the app's sound reaches the speakers, beyond what the
 * browser itself reports: 0, except while the app's sound goes through the recording engine
 * (see through.ts), whose queue holds it back a little. The canvas paints what is heard, so it
 * takes this off too.
 */
let extra = 0;
export const extraDelay = (): number => extra;
export function setExtraDelay(seconds: number) {
  extra = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
