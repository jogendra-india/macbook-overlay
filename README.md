# Markdown Overlay

A frosted, always-on-top markdown overlay for macOS that is **invisible to screen
sharing and recording** (Zoom, Meet, QuickTime, screenshots). Read or edit notes
in a floating panel while you share your screen.

## Features
- **Hidden from screen capture** — `setContentProtection(true)` (digital capture only).
- **Always on top**, on every Space, even over fullscreen apps.
- **Menu-bar control** — click the `▣` menu-bar item to show/hide.
- **Global shortcuts** (work from any app):
  | Shortcut | Action |
  |---|---|
  | ⌥⌘O | Toggle overlay |
  | ⌥⌘= / ⌥⌘- | Opacity up / down |
  | ⌥⌘0 | Reset opacity |
  | ⌥⌘→ | Move to next display |
  | ⌥⌘F | Open file |
  | ⌥⌘N | New note |
- **Markdown rendering** with live reload when the file changes on disk.
- **Inline editing** with debounced autosave back to the file.
- **New note** button → saved to `~/Documents/Overlay Notes`.
- Scrollable, draggable, resizable; opacity / display / size persist.

## Run (dev)
```bash
npm install
npm start
```

## Build a .app
```bash
npm run dist
```
Outputs to `dist/`:
- `dist/mac-arm64/Markdown Overlay.app` — the app bundle
- `dist/Markdown Overlay-<ver>-arm64.dmg` — installer

Install by dragging the `.app` into `~/Applications` (or `/Applications`), then
launch it and enable **Open at login** from the menu-bar `▣` menu. The app is
ad-hoc signed (no Apple Developer ID), so the first launch may need a
right-click → **Open** to get past Gatekeeper.

## Caveat
Content protection hides the window from *digital* capture only. A phone photo of
the screen still shows it, and a rare capture path may not honor the flag.
