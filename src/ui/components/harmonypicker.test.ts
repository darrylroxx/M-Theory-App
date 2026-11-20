/** What the Harmonize sheet says when a harmony is kept. */
import { describe, expect, it } from "vitest";
import { keptMessage } from "./HarmonyPicker";

describe("the toast when a harmony is kept", () => {
  it("names a new track, or the track and the harmony now in it", () => {
    expect(keptMessage(true, "High chords", "High chords")).toBe("High chords added");
    expect(keptMessage(false, "Chords 2", "High chords")).toBe("Chords 2: High chords");
  });
  it("says the name once when the track is called by its harmony (written over by Harmonize, it takes the new one's name)", () => {
    expect(keptMessage(false, "Guide tones", "Guide tones")).toBe("Guide tones");
    expect(keptMessage(false, "Guide tones 2", "Guide tones")).toBe("Guide tones 2");
  });
  it("and says which chords it plays in place of", () => {
    expect(keptMessage(false, "Chords 2", "Relative", "Chords")).toBe("Chords 2: Relative, in place of Chords here");
  });
});
