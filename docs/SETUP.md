# One-time setup (about 10 minutes)

Four things only the repository owner can do in GitHub's settings. After these, every update
reaches your PC on its own.

## 1. Save the update key (lets your installed apps trust updates)

1. On GitHub, open the repository → **Settings** → **Secrets and variables** → **Actions**.
2. **New repository secret**.
3. Name: `TAURI_SIGNING_PRIVATE_KEY`
4. Secret: open the file `TAURI_SIGNING_PRIVATE_KEY.txt` you were sent, copy **all** of its text, paste it.
5. **Add secret**. Then delete the file from your computer (GitHub keeps it safely; nobody,
   including you, can read it back from GitHub).

Keep one private copy somewhere safe (a password manager), because if the key is ever lost, the
installed apps can no longer update and must be reinstalled once.

## 2. Make the repository public (open source)

**Settings** → **General** → scroll to **Danger Zone** → **Change repository visibility** →
**Make public**. Installed apps download their updates from the public Releases page, so updates
only work once the repository is public.

## 3. Make `main` the default branch

**Settings** → **General** → **Default branch** → switch to `main` → **Update**.

## 4. Turn on GitHub Pages (the web version, for iPhone and iPad)

**Settings** → **Pages** → **Build and deployment** → Source: **GitHub Actions**.

## 5. Protect `main` (recommended)

**Settings** → **Rules** → **Rulesets** → **New branch ruleset**: target `main`, turn on
**Restrict deletions** and **Block force pushes**. Also make sure two-factor authentication is on
for your GitHub account (**Settings** of your account → **Password and authentication**).

## Installing on your PC

1. Open the repository's **Releases** page.
2. Release **Draft** (tag `draft-latest`) → download `M-Theory-Draft-setup.exe` and run it. (The published app,
   `M-Theory-setup.exe`, appears in the latest release once something has been published.)
3. Windows may show **"Windows protected your PC"**: choose **More info** → **Run anyway**.
4. For the audio interface: install the **Focusrite USB ASIO** driver from focusrite.com (Scarlett
   Solo 3rd Gen downloads). In the app, **⚙ Settings → Audio interface** shows whether it is found.
