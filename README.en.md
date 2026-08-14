# dsh-desktop-launcher

A tiny [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that installs a **desktop double-click launcher** for the harness: a `dsh.app` with the official black-whale icon (macOS) or a `dsh.desktop` entry (Linux). Double-click it and the web UI starts and your browser opens. Everything is a plugin — this whole thing is just a bundle.

**Lightweight:** zero dependencies, ~147 KB package (mostly two 1024px icon PNGs; the macOS `.icns` is generated on the fly with the built-in `sips` + `iconutil`). It only touches the desktop side — no terminal command, no bundled scripts in your PATH. The terminal launcher lives in the separate [dsh-launcher](https://github.com/LvienOeria/dsh-launcher) package, so you install exactly what you want.

## What it does

Loaded as a bundle, the plugin's `apply` runs on every harness boot and **converges** these artifacts (idempotent: a fast no-op when the config is unchanged):

| Artifact | Where | What |
|---|---|---|
| Launcher script | `~/.dsh-launcher-desktop/dsh-start.command` | starts dsh, polls the web UI URL, opens the browser when ready |
| macOS app | `~/Desktop/dsh.app` | double-clickable, official whale icon, opens Terminal running the launcher |
| Linux entry | `~/.local/share/applications/dsh.desktop` | app-menu launcher (Terminal=true) |
| Icon | bundled `whale` / `whale-dark` (1024px PNGs) | official deepseek-harness black-whale mark on a rounded card |

## Install

Prerequisites: the `dsh` CLI and **pnpm ≥ 9** (the harness pins pnpm 11 — `corepack enable` if yours is older).

From npm:

```sh
dsh plugin --profile web add dsh-desktop-launcher
```

From GitHub — plain JS, **no build step**, so nothing to allowlist:

```sh
dsh plugin --profile web add github:LvienOeria/dsh-desktop-launcher
```

Local path installs work too (zero dependencies):

```sh
dsh plugin --profile web add ./dsh-desktop-launcher
```

Then start dsh once — the plugin generates the launcher:

```sh
dsh --profile web      # installed CLI
# or
pnpm dsh web           # source checkout (auto-detected)
```

Done. Double-click **dsh** on your Desktop; closing the terminal window it opens stops the harness.

## Customize

Edit your profile's patch layer (`~/.dsh/profiles/<profile>/cordis.patch.yml`) — later layers win, and a patch replaces a row's whole `config`:

```yaml
- id: dsh-desktop-launcher
  config:
    launcherName: dsh                      # desktop app / entry name
    iconStyle: whale-dark                  # whale | whale-dark
    iconFile: ''                           # absolute path to your own .icns/.png
    url: http://127.0.0.1:3080             # web UI URL to poll and open
    sourceDir: /path/to/deepseek-harness   # run `pnpm dsh web` from a checkout
    startCommand: ''                       # fully custom start command (single line)
    autoOpenBrowser: true
```

### Custom icons

Drop any `.icns` (macOS) or `.png` (Linux) anywhere and point `iconFile` at it; a `.png` on macOS is converted to `.icns` automatically. The built-in `whale` / `whale-dark` styles are the official mark on light/dark cards; regenerate them from the harness favicon with `python3 scripts/build-icons.py /path/to/deepseek-harness/apps/web/public/favicon.svg` (needs Pillow + macOS `sips`).

### How the start command is resolved

1. `startCommand` (explicit)
2. `sourceDir` → `cd <dir> && pnpm dsh web`
3. cwd is a source checkout whose `package.json` has a `dsh` script
4. an installed `dsh` CLI on PATH (recursion guard: never our own wrapper)
5. fallback `dsh --profile web` (with a warning)

## How it stays safe

- Every generated file carries a `# managed by dsh-desktop-launcher vX` marker. An existing file or app bundle **without** the marker is backed up to `<path>.bak` before replacement (never silently clobbered).
- Unchanged config → nothing is rewritten (state hash in `~/.dsh-launcher-desktop/state.json`).
- Bad config (unknown `iconStyle`, missing `iconFile`, non-http(s) `url`, multi-line `startCommand`) fails loudly with a clear message.
- Install failures are logged prominently but never take the harness down — dsh still boots.

## Uninstall

```sh
dsh plugin --profile web remove dsh-desktop-launcher
rm -rf ~/.dsh-launcher-desktop ~/Desktop/dsh.app
# plus, on Linux: ~/.local/share/applications/dsh.desktop
```

## Notes

- macOS: the first launch may ask you to confirm opening the generated app — that is Gatekeeper, click Open.
- The whale mark is from [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (`apps/web/public/favicon.svg`); it is used here solely for the launcher icon.
- Want a terminal command instead of / in addition to the desktop app? Install [dsh-launcher](https://github.com/LvienOeria/dsh-launcher).
- Windows is not supported (nothing is installed; a warning is logged).

## License

MIT — see [LICENSE](LICENSE).
