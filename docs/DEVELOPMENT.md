# Architecture and development

The Manifest V3 extension owns Chrome API access. The optional Swift/AppKit companion owns the floating WebKit panel and the macOS event tap. A local native-messaging connection carries framed JSON; no listening TCP port is used.

`extension/core.mjs` contains pure ordering, shortcuts, matching, URL, and completion logic. `search.mjs` ranks local suggestions. `favicons.mjs` reads Chrome’s local favicon cache with bounded concurrency, timeouts, and payload size. `background.js` brokers browser actions and native requests. The palette UI works as a Chrome popup or as a native WebKit page.

`companion/bundle_native.py` produces a classic script for WebKit’s file-based loader from the extension modules. The installed UI cache is separate from the signed app so UI updates do not invalidate an existing Accessibility grant.

`history-cache.mjs` keeps a bounded recent-history cache in memory, invalidates deleted entries, and coalesces deeper Chrome history queries. Search uses the existing native `search` message with `local`, `history`, and optional `web` phases. The first phase never waits for history scans, favicon/group reads, or a network response. The UI merges later results only for the current query and preserves a selection already made with the keyboard.

## Checks

```sh
node --test tests/*.test.mjs
python3 -m py_compile install.py companion/bundle_native.py
python3 -m unittest discover -s tests -p 'test_*.py'
bash -n companion/build.sh
```

Build on macOS with Apple’s Command Line Tools. For an isolated build, set `TAB_PALETTE_BUILD_DIR` to a fresh temporary directory and run `bash companion/build.sh`. The verified staging bundle is `TabPaletteBundle` inside that directory. Run its executable with `--self-test` to check the WebKit UI, bridge, input, and script loading without showing a window, querying Accessibility, or connecting to Chrome. The check requires a macOS graphical login session because it uses AppKit/WebKit.

Avoid rebuilding an installed helper for UI-only changes. Native changes require a rebuild and may require the user to re-add the app to Accessibility. Do not automate security dialogs, modify the TCC database, or use a listen-only event tap: exact Cmd+T requires a modifying tap that suppresses Chrome’s New Tab action.

Native stdout must contain only little-endian length-prefixed JSON. Use stderr for diagnostics. Keep the extension ID and native host origin synchronized. The public manifest key is intentional; do not replace it during routine setup.

Chrome API references: [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [commands](https://developer.chrome.com/docs/extensions/reference/api/commands), [New Tab overrides](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages), and [search](https://developer.chrome.com/docs/extensions/reference/api/search).

## Manual acceptance

Check current-window tab order (including pinned/grouped tabs), stable labels while filtering, cached favicons and missing-icon fallback, Cmd+T toggle, number/letter shortcuts, arrows/Return/Escape, immediate URL submission, hostname completion/deletion, default-provider search, collapsed-group expansion, and no new-tab flash when native capture is active. Use disposable tabs and local fixture data. Check that Google autocomplete remains off unless explicitly enabled and permitted.

## Demo

`demo/` contains the editable, deterministic UI film with public-brand sample tabs. It exposes `window.caseMotion.renderAt(milliseconds)` and has no network dependency. See its README/storyboard for rendering. It is a component-derived demonstration, not a recording of someone’s private browser. Public exports are attached to the GitHub release.

## Contributing

Open an issue describing the Chrome/macOS version and a reproducible sequence; redact personal titles, URLs, and screenshots. Keep changes focused and include tests for meaningful logic changes. Please discuss new permissions or remote services before adding them. Native support for other operating systems needs an OS-specific companion; changing a shortcut declaration alone cannot provide exact reserved-key interception.
