// The settings for one build, merged into src-tauri/tauri.conf.json by `tauri build --config`:
// the version, and for the draft app its own name, identity and update address.
//   node scripts/desktop-config.mjs <draft|main> <version> <signed: yes|no>  > build.conf.json
import { readFileSync } from "node:fs";

const [channel, version, signed] = process.argv.slice(2);
const conf = channel === "draft" ? JSON.parse(readFileSync("src-tauri/tauri.draft.conf.json", "utf8")) : {};
conf.version = version;
// without the signing key the installer is still built, but it cannot carry updates
if (signed !== "yes") conf.bundle = { ...(conf.bundle ?? {}), createUpdaterArtifacts: false };
process.stdout.write(JSON.stringify(conf));
