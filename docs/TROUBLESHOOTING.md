# Troubleshooting

## A New Tab flashes before the palette

This is the extension-only fallback. Open the extension’s Options page from its `chrome://extensions` card. The native experience should report **“Direct Cmd+T capture is active.”**

If the companion is disconnected, run `python3 install.py --apply`, confirm the extension ID, and reload the extension. In Accessibility, make sure you added **`~/Applications/Tab Palette Companion.app`**, not a build copy in the repository. Return to Chrome before pressing Cmd+T; capture intentionally runs only when Chrome is frontmost.

If the switch is blue but capture stays inactive after a native rebuild, macOS may remember the previous code signature. Remove the old entry with **−**, add the actual installed app again with **+**, and enable it. Complete any security prompt yourself. Reload the extension, then check Options again.

## The companion is not connected

- Verify `python3 install.py` reports the intended paths and extension ID.
- The native host manifest is `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.tesar.tab_palette.json`.
- Its `path` must point to the executable `native-host` wrapper under `~/Library/Application Support/Tab Palette`.
- Its `allowed_origins` must match the extension’s ID, including the trailing `/`.
- Reload the extension after installing the host. Restart Chrome if a previous host remains attached, saving work first.
- The installer supports Google Chrome’s normal per-user data location. Chrome Beta/Canary, Brave, Edge, custom `--user-data-dir` profiles, and managed installations may use other host locations and are not configured automatically.

## Shortcuts or the New Tab page conflict

Another New Tab extension may own the override. Disable the competing override or choose which extension should control New Tab. You can inspect the alternate command at `chrome://extensions/shortcuts`; the default is Cmd+Shift+K on macOS or Ctrl+Shift+K elsewhere.

Native tab shortcuts use Command while the palette is open; the browser-popup fallback uses Option/Alt. Plain letters type into the search field. Cmd+T closes an open native palette, so T is omitted from tab labels. With more than 35 tabs, hold the modifier while entering a two-character label. Shortcuts refer to original tab positions even after filtering.

## Multiple profiles or windows

Tab lists belong to the window that invoked the palette. The native companion is designed for one Chrome profile at a time; concurrent native hosts from multiple enabled profiles can compete for Cmd+T. Enable this extension in one profile for predictable native capture. The host manifest is registered per macOS user, not per Chrome profile.

## Suggestions differ from Chrome’s address bar

Chrome exposes history and bookmarks but not the omnibox’s complete suggestion engine or ranking. Tab Palette builds its own list. Google autocomplete is optional and off by default. A recognized URL goes to that address; other text searches with your default provider. Some special URL schemes are intentionally rejected rather than sent as a search.

## Install/build fails

Check `sw_vers`, `python3 --version`, and `xcrun --find swiftc`. Complete `xcode-select --install` if compiler tools are missing. Follow the installer's error output; it should leave an existing working installation intact. No sudo is needed. Keep the source in a permanent local directory and avoid using a temporary download folder as the unpacked-extension location.

## Remove Tab Palette

First remove the extension from `chrome://extensions`. This restores Chrome’s usual New Tab behavior unless another extension controls it. Then preview and apply companion removal:

```sh
python3 install.py --uninstall
python3 install.py --uninstall --apply
```

Remove the app’s entry from **System Settings → Privacy & Security → Accessibility** yourself. Restart Chrome if an old native host is still connected. The installer does not delete tabs, bookmarks, history, passwords, or Chrome profile data. Installation backups, if any, are reported separately and can be reviewed before you delete them. You can remove the repository after unloading the extension.
