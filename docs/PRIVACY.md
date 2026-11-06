# Privacy and permissions

Tab Palette has no analytics, telemetry, account system, backend, remote code, or crash-report uploader. Browser metadata stays on the computer during suggestion generation. Data is still sent normally to a website or search engine when you choose to navigate there.

| Permission | Purpose |
| --- | --- |
| `tabs` | Read titles, URLs, IDs, order, and window information; activate a chosen tab and create a destination tab. |
| `tabGroups` | Read group labels and expand a collapsed group when switching to its tab. |
| `history` | Find matching visited pages for local suggestions. |
| `bookmarks` | Find matching saved pages for local suggestions. |
| `search` | Submit a selected search with Chrome’s configured default search engine. |
| `storage` | Save local extension preferences. |
| `favicon` | Read icons already in Chrome’s favicon cache. There is no third-party favicon lookup. |
| `nativeMessaging` | Exchange local JSON messages with the optional macOS companion through standard input/output. |
| Accessibility (macOS) | Let the companion intercept Cmd+T while Google Chrome is frontmost, and route palette shortcuts. |

The extension has no content scripts or all-websites permission. It does not read page bodies, passwords, cookies, or browser credential databases. Existing bookmarks and history are not changed. The local Swift helper receives the tab/suggestion metadata needed to display the palette, not a copy of the browser profile. It registers no login item or scheduled task.

## Recent-history cache

To show suggestions promptly, the extension keeps up to 5,000 recent history entries in memory while it runs. It does not write a separate history database or save this cache to extension storage. Chrome’s history-removal events invalidate the affected entries. Older matches are still queried from Chrome in the background; rapid typing skips obsolete queued searches. Nothing from this cache is sent to a server.

## Optional Google autocomplete

Off by default. Turning it on in Options asks Chrome for access to `https://suggestqueries.google.com/*`. When it is enabled and permitted, the text typed into the palette is sent to that Google endpoint. Tab lists, history entries, and bookmarks are not sent with it. Google’s own service and privacy terms apply. Turning the option off removes that optional host permission. Search submission still uses your Chrome default provider.

## Local files

The installer writes the companion app, UI cache, native host wrapper, and a host manifest. Their exact destinations are shown by `python3 install.py`. Chrome continues to manage extension settings and the browser’s existing history/bookmarks. The manifest limits the native host to the configured extension origin; its checked-in RSA public key stabilizes the extension ID and is not a secret.

See [Troubleshooting](TROUBLESHOOTING.md) for removal. Accessibility is a powerful macOS permission: review the source and approve the installed app only if you want exact native shortcuts. You can use the extension-only fallback without it.
