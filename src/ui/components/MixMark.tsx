import { mixWith, quietWhy, type TrackId } from "../../audio/mix";
import { useApp } from "../state";

/**
 * Beside the track a page is editing: its M while it is muted on the Track page, or an S while other
 * tracks are soloed there and it is not. Everything the track plays goes through its fader, a tap on
 * the page too, so without this the page would just go quiet. A tap lets it be heard (unmuted, or
 * soloed along with the others). Nothing shows while the track is heard.
 */
export function MixMark({ id, name }: { id: TrackId; name: string }) {
  const { state, set } = useApp();
  const why = quietWhy(state.progression.mix, id);
  if (!why) return null;
  const hear = () => set((s) => ({ ...s, progression: { ...s.progression, mix: mixWith(s.progression.mix, id, why === "mute" ? { mute: false } : { solo: true }) } }));
  return why === "mute" ? (
    <button className="tv-ms on mix-mark" aria-label={`Unmute ${name}`} title="Muted on the Track page: tap to hear it" onClick={hear}>M</button>
  ) : (
    <button className="tv-ms solo mix-mark" aria-label={`Solo ${name} too`} title="Other tracks are soloed on the Track page: tap to solo this one too" onClick={hear}>S</button>
  );
}
