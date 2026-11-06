# Storyboard and provenance

## Storyboard

| Time | Visible behavior |
| --- | --- |
| 0.0–1.5 s | A dark Chrome window settles on an anonymous design workspace over an abstract macOS-like wallpaper. Eleven public development/product tabs are already open. |
| 1.55–2.5 s | A small Cmd+T key cue appears; the palette opens over the current page. The tab strip remains unchanged. |
| 2.25–4.25 s | The ordered open-tab list holds with Cmd+1–9 badges, then gently scrolls to expose Cmd+0 and Cmd+A. A fixed return/arrow-key footer remains in place; scroll edges fade rather than cutting a partial row sharply. |
| 4.3–6.35 s | Typing `git` filters the tabs while `github.com` appears as a selected inline completion. Local-style history and website suggestions appear below. |
| 6.38–7.16 s | Cmd+1 highlights the matching GitHub tab, closes the palette, and activates the existing tab. No tab is added. |
| 7.16–9.25 s | The existing public `vercel/next.js` repository page holds. |
| 9.25–10.1 s | Cmd+T opens the same palette over GitHub, still without adding a tab. |
| 10.65–14.4 s | The address `supabase.com/docs` is typed; its direct website action is selected above search. |
| 14.4–15.18 s | Enter opens a real destination tab for Supabase Docs. The browser tab count increases from eleven to twelve. |
| 15.18–18.25 s | The new documentation destination holds long enough to read. |
| 18.25–19.0 s | The browser quietly fades to the wallpaper for the loop boundary. |

Poster: **5700 ms**. Duration: **19000 ms**. Output stage: **1080 × 588**, captured at native **3×**.

## Product fidelity

The palette uses a local snapshot of the shipped extension’s compact `palette.css`, the same class structure, the same title/domain row layout, favicon placement, selected-result treatment, shortcut badges, search field, and escape control. The deterministic scene drives only the demonstrated fixture states. It does not execute the extension, capture a live browser, or contact its backend.

The surrounding browser shell is one persistent DOM shell. Only its active tab state, address, and page content change. No second full browser shell is crossfaded. The design workspace is an anonymous mock fixture; the GitHub and Supabase pages are compact illustrative reconstructions of public destinations, not screenshots or evidence of a signed-in account. Metrics, user identities, private repositories, customer data, and live activity are omitted.

The surrounding page is lightly dimmed and blurred while the palette is open to keep the small film legible. This is a presentation treatment; the native companion does not dim the underlying browser page.

## Privacy and offline rendering

All fixture URLs are public product/developer destinations or `localhost`. No source browser profile, saved-tab export, account information, email address, private project, cookie, session token, or customer record is embedded. Public brand marks identify the browser tabs. Every image and dependency is stored locally, so capture requires no network requests. The wallpaper is an original local SVG composition.

## Assets and notices

- `assets/github.svg`, `linear.svg`, `vercel.svg`, `figma.svg`, `supabase.svg`, `mdnwebdocs.svg`, `notion.svg`, `stripe.svg`, `redis.svg`, and `docker.svg` were retrieved from the [Simple Icons source repository](https://github.com/simple-icons/simple-icons/tree/develop/icons) on 2026-11-06. Paths are `/icons/{name}.svg`. Their geometry is retained, with a fixed foreground fill chosen for legibility on the dark browser chrome.
- Simple Icons is distributed under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Brand names and trademarks remain the property of their respective owners. See [brand notices](assets/brand-notices.txt).
- `assets/localhost.svg` and `assets/wallpaper.svg` are original vectors authored for this demo.
- The five small UI glyph PNGs (`palette-mark`, `extension-mark`, `site-controls`, `folder`, and `search`) are rendered at 4× source resolution from the original UI vectors. This avoids a Chromium inline-SVG stroke raster-cache discrepancy during repeated seeking; it does not upscale a captured screen. The bundled renderer's exact repeated-seek pixel check passes without tolerance changes.
- `palette-source.css` is copied from this project’s extension UI. The motion helper and render/encoding scripts were supplied with the project’s deterministic case-study production template. They are included locally so the film can be reproduced without private filesystem paths or external template dependencies.

Public page references: [GitHub](https://github.com/vercel/next.js), [Figma](https://www.figma.com/), [Supabase Docs](https://supabase.com/docs). Their appearance in the demo indicates navigation destinations, not affiliation or endorsement.

## Review checklist

Review the captured poster and transition stills for readable type, selected inline completion, original tab ordering, Cmd+1 switching an existing tab, direct-URL navigation, stable browser chrome, unclipped palette edges, and anonymous fixtures. Inspect representative encoded frames as well as the source page. Rendering and encoding success alone do not establish visual quality.
