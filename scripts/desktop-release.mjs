// Run on the Windows build machine after `tauri build`.
// Gives the installer a plain name, and writes latest.json, which tells installed apps that a
// new version exists, where to download it, and its signature (an app installs only signed updates).
//   node scripts/desktop-release.mjs <draft|main> <version> <tag> <out-dir>
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [channel, version, tag, out] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY ?? "darrylroxx/M-Theory-App";
const dir = "src-tauri/target/release/bundle/nsis";
const exe = readdirSync(dir).find((f) => f.endsWith("-setup.exe"));
if (!exe) throw new Error(`no installer in ${dir}`);
const name = channel === "draft" ? "M-Theory-Draft-setup.exe" : "M-Theory-setup.exe";
mkdirSync(out, { recursive: true });
copyFileSync(join(dir, exe), join(out, name));
const sig = join(dir, `${exe}.sig`);
if (existsSync(sig)) {
  const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
  const signature = readFileSync(sig, "utf8").trim();
  const notes = (process.env.NOTES ?? "").split("\n")[0].slice(0, 200);
  const latest = { version, notes, pub_date: new Date().toISOString(), platforms: { "windows-x86_64": { signature, url }, "windows-x86_64-nsis": { signature, url } } };
  writeFileSync(join(out, "latest.json"), JSON.stringify(latest, null, 2));
  console.log(`latest.json: ${version} → ${url}`);
} else console.log("not signed: no latest.json (add the TAURI_SIGNING_PRIVATE_KEY secret to turn on updates)");
