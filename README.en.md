<p align="center">
  <img src="https://github.com/user-attachments/assets/b5d0e863-48be-497b-b0e9-4bd8d8ce9bf0" alt="Folia" width="100%" />
</p>

<div align="center">

# Folia · local edition

**Plays what is on this disk. No network, no sign-in.**

</div>

---

## What this is

A personal fork of [Folia](https://github.com/chthollyphile/folia-major). Upstream is built around online music providers, AI lyrics and a multi-page player; this fork removes all of that and keeps **the poster wall** and **local file playback** — something that stays on the desktop as a wallpaper.

In one sentence: **scan a local music folder, lay the covers out as a wall, click to play, and keep a record of what you listened to.**

---

## Features

| Capability | Detail |
|---|---|
| **Local library** | Point it at a folder (e.g. `E:\音乐`), it walks it for flac / mp3 / m4a |
| **Poster wall** | A grid of covers, scroll to browse, click to play |
| **Wallpaper form** | The window sits under the desktop icons; this fork has no other form |
| **Embedded covers only** | Reads the art inside the audio file, never a lookup |
| **Lyrics** | Reads a sibling `.lrc` or embedded lyrics, plain scrolling text (no animated styles) |
| **Listening statistics** | Per day, per hour, per song; exported as `folia-stats.js` for a local heatmap page |
| **Hotkey** | `Ctrl+Alt+Shift+F` raises and focuses the window, so a stray click on the desktop does not |
| **Fully offline** | The renderer replaces `fetch` / `XHR` / `WebSocket` / `EventSource` / `sendBeacon` with failing stubs; the main process cancels every http(s) request through `session.webRequest` |

---

## Compared with upstream

| Item | Upstream Folia | This fork |
|---|---|---|
| Online providers | Netease, QQ, Kugou, Qishui, YouTube… | **all removed** |
| Account sign-in | OAuth / cookies per platform | **no entry point** |
| Network requests | search, lyrics, covers, AI | **none** (two layers) |
| AI features | themes, segmentation, lyrics | **disabled** |
| Lyric visuals | a dozen WebGL / Pixi styles | **plain text only** |
| Screens | home / player / settings / queue | **poster wall only** (rest planned) |
| Wallpaper mode | optional | **the only mode** |
| Cover source | online match + embedded | **embedded only** |
| Remote window | separate window, opened by hand | same (auto-open planned) |
| Listening stats | none | **added**, per day / hour / song |
| Getting to it | normal window | **global hotkey** |

---

## Limits

- Dragging the progress bar back does not count as another play (only a natural loop does)
- A song skipped in under five seconds records time but not a play
- Old covers are not cleaned up when a song is deleted or its art changes
- On first use, covers are copied out a few dozen at a time; some may be missing until it settles

---

## License

Upstream's **AGPL-3.0**, see [LICENSE](LICENSE). Changes are marked in the history with the `local-only build:` prefix.
