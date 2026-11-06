# Product demo

This is a silent, deterministic 19-second product film. It shows the compact Tab Palette inside one persistent Chrome window: Cmd+T opens the palette, `git` filters tabs and completes `github.com`, Cmd+1 switches to the existing GitHub tab, then a second Cmd+T and a typed address open Supabase Docs.

The stage is 1080 × 588 logical pixels. Capture at its native 3× density for 3240 × 1764 stills and video. The source page exposes `window.caseMotion.duration`, `posterMs`, and the idempotent `renderAt(ms)` API. No server, login, Chrome profile, extension installation, or network access is needed to render it.

## Render stills first

From the repository root, point these variables at an existing Playwright installation and compatible Chromium executable. The tools do not install a browser or start a server.

```sh
export PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright
export CHROMIUM_EXECUTABLE=/absolute/path/to/chromium

node demo/tools/render-motion.mjs \
  --input "$PWD/demo/index.html" \
  --output "$PWD/work/demo-stills" \
  --stills 0,2400,3600,5700,6550,7100,10200,12500,15100,18000,18800
```

Inspect the stills at reading size before rendering the full sequence. The recommended poster is 5700 ms, with the selected inline completion and a matching open tab visible.

## Capture and encode

```sh
node demo/tools/render-motion.mjs \
  --input "$PWD/demo/index.html" \
  --output "$PWD/work/demo-full-capture" \
  --frames

node demo/tools/encode-motion.mjs \
  --capture "$PWD/work/demo-full-capture" \
  --output "$PWD/media/tab-palette-demo" \
  --poster-ms 5700 \
  --ffmpeg /absolute/path/to/ffmpeg
```

The encoder writes silent H.264 MP4, VP9 WebM, and a full-resolution poster. Use one browser and serial capture/encoding; encoder threads are limited to two. Keep the source, poster, exports, and QA metadata. Numbered render frames can be removed after the encoded output is checked.

See [storyboard and provenance](provenance.md) for the timeline, source fidelity, privacy, and asset notices.
