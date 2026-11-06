#!/bin/bash
set -euo pipefail
companion_dir="$(cd "$(dirname "$0")" && pwd)"
palette_dir="$(dirname "$companion_dir")"
app_dir="${TAB_PALETTE_APP_OUTPUT-$companion_dir/Tab Palette Companion.app}"
build_root="${TAB_PALETTE_BUILD_DIR:-$palette_dir/.build}"
stage_dir="$build_root/TabPaletteBundle"
# The non-.app staging name avoids Finder/File Provider adding custom-icon
# attributes to a bundle while it is being signed inside Documents.
if [[ -L "$stage_dir" ]]; then
    printf '%s\n' "Refusing a symbolic-link build destination: $stage_dir" >&2
    exit 1
fi
if [[ -e "$stage_dir" ]]; then
    existing_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$stage_dir/Contents/Info.plist" 2>/dev/null || true)
    if [[ "$existing_id" != 'ai.tesar.TabPalette' ]]; then
        printf '%s\n' "Refusing to overwrite an unrelated build destination: $stage_dir" >&2
        exit 1
    fi
    rm -rf "$stage_dir"
fi
mkdir -p "$stage_dir/Contents/MacOS" "$stage_dir/Contents/Resources"
/usr/bin/swiftc "$companion_dir/TabPalette.swift" -O -target "$(/usr/bin/uname -m)-apple-macos14.0" -framework AppKit -framework WebKit -framework ApplicationServices -o "$stage_dir/Contents/MacOS/TabPalette"
cat > "$stage_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Tab Palette Companion</string>
<key>CFBundleDisplayName</key><string>Tab Palette Companion</string>
<key>CFBundleIdentifier</key><string>ai.tesar.TabPalette</string>
<key>CFBundleExecutable</key><string>TabPalette</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0.0</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
version=$("${PYTHON:-python3}" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$palette_dir/extension/manifest.json")
if [[ ! "$version" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
    printf '%s\n' "Invalid extension/native bundle version: $version" >&2
    exit 1
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$stage_dir/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$stage_dir/Contents/Info.plist"
if [[ -d "$palette_dir/extension" ]]; then
    /usr/bin/ditto --norsrc --noextattr "$palette_dir/extension" "$stage_dir/Contents/Resources/extension"
    "${PYTHON:-python3}" "$companion_dir/bundle_native.py" "$stage_dir/Contents/Resources/extension"
fi
# This local ad-hoc signature needs no developer certificate. Its designated
# requirement contains a code hash: rebuilding can require re-adding the app
# to Accessibility. UI-only installer updates keep this signed bundle intact.
/usr/bin/codesign --force --sign - "$stage_dir"
/usr/bin/codesign --verify --strict "$stage_dir"
if [[ -n "$app_dir" ]]; then
    if [[ -L "$app_dir" ]]; then
        printf '%s\n' "Refusing a symbolic-link app destination: $app_dir" >&2
        exit 1
    fi
    if [[ -e "$app_dir" ]]; then
        existing_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_dir/Contents/Info.plist" 2>/dev/null || true)
        if [[ "$existing_id" != 'ai.tesar.TabPalette' ]]; then
            printf '%s\n' "Refusing to overwrite an unrelated app: $app_dir" >&2
            exit 1
        fi
        rm -rf "$app_dir"
    fi
    /usr/bin/ditto --norsrc --noextattr "$stage_dir" "$app_dir"
    printf '%s\n' "Built: $app_dir"
fi
printf '%s\n' "Signed/verified source: $stage_dir"
printf '%s\n' "Install by copying with ditto --norsrc --noextattr outside iCloud/Documents, then verify the installed app."
