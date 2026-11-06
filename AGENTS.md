# Working on Tab Palette

Read README.md and the relevant docs before installing or changing code.

- For a user's setup request, follow docs/AGENT_SETUP.md. Keep Google autocomplete off unless requested.
- Preserve browser tabs, bookmarks, history, and profile files. Load extensions through supported Chrome UI.
- Accessibility grants and macOS security dialogs must be completed by the user. Never bypass them or alter the TCC database.
- UI-only updates use `python3 install.py --apply`; keep the installed app signature. Rebuild native code only when necessary and explain the possible Accessibility re-approval.
- Validate extension behavior with `node --test tests/*.test.mjs`. Native changes also need a clean temporary build and the app's `--self-test` on macOS.
- Native stdout is exclusively framed JSON. Keep debug logging off stdout.
- Never load remote code or favicons in the palette. Keep optional network suggestions permission-gated.
- Do not commit compiled apps, installation backups, user screenshots, browser data, local paths, private signing material, or capture frame sequences. Public demo fixtures must stay anonymous.
- Demo rendering uses file://, one headless browser, deterministic renderAt(ms), and no server. Review stills before encoding.
