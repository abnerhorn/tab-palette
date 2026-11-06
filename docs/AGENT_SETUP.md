# Set up Tab Palette with an agent

Copy this prompt into an agent that can run local commands and help with Chrome/macOS settings:

```text
Install Tab Palette from https://github.com/abnerhorn/tab-palette on this Mac.
Read README.md, AGENTS.md, docs/PRIVACY.md, and docs/TROUBLESHOOTING.md first.
Clone it into a permanent user-owned folder; keep existing browser data intact.
Check macOS 14+, Chrome 120+, Python 3.8+, and Xcode Command Line Tools. Run the
installer dry-run, inspect its plan, then run python3 install.py --apply.
Help me load the repository's extension/ folder at chrome://extensions with
Developer mode. Confirm ID kbpdjjioplffgdanficjaoccbhlkjfcg. Explain the browser
permissions. Leave optional Google autocomplete off.
Guide me to approve ~/Applications/Tab Palette Companion.app in macOS
Accessibility myself. Do not bypass security prompts or edit TCC databases.
Verify Options says "Direct Cmd+T capture is active." Test Cmd+T without a
new-tab flash, ordered tab shortcuts, filtering, a direct URL, and Escape.
Use disposable test tabs; preserve my existing tabs, history, and bookmarks.
Do not re-sign a working installed helper just to refresh UI. Report the
install paths, checks performed, and any steps I still need to complete.
```

## Handoffs the person must complete

macOS Accessibility approval belongs to the person using the computer. An agent should prepare the correct installed app path, explain why the permission is needed, and wait for them to finish. Chrome or a managed-device policy may also require a manual extension-install step. Do not call the setup complete until the native status and behavior are checked.

## What the agent can do

1. Inspect the source, check prerequisites, and run unit tests if Node is available.
2. Run `python3 install.py` to preview paths and decisions.
3. Run `python3 install.py --apply` after the user has requested installation.
4. Load `extension/` through Chrome’s supported unpacked-extension UI, or guide the user to do it. Do not write Chrome Preferences files.
5. Verify the fixed extension ID matches the host’s `allowed_origins` and test native status through Options.
6. Use the troubleshooting guide if Accessibility appears enabled but capture is inactive. Preserve the existing signed app on UI-only updates.

No browser automation server, remote service, private key, `.env`, or credentials are required. Exact Cmd+T works only with Google Chrome in front. The local companion does not run as a login item; Chrome starts it through native messaging.

If the installer reports an older private prototype, remove the old unpacked extension before using `--apply --rebuild-native`, then load this repository’s `extension/` folder. Reloading the old card does not change its source folder. Explain that this native upgrade will need the person to re-add the installed app in Accessibility. Do not work around an incompatible native host by removing its version check.
