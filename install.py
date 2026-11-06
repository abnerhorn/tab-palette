#!/usr/bin/env python3
"""Install or remove the optional macOS native bridge. Default: read-only plan."""
from __future__ import annotations

import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent
APP_ID = 'ai.tesar.TabPalette'
HOST_NAME = 'ai.tesar.tab_palette'
MIN_NATIVE_VERSION = (1, 1, 0)
HOME_DIR = Path.home()
APP = HOME_DIR / 'Applications/Tab Palette Companion.app'
HOST = HOME_DIR / 'Library/Application Support/Google/Chrome/NativeMessagingHosts/ai.tesar.tab_palette.json'
SUPPORT = HOME_DIR / 'Library/Application Support/Tab Palette'
MARKER = SUPPORT / 'installation.json'
WRAPPER = SUPPORT / 'native-host'
UI = SUPPORT / 'ui'


def read_json(path: Path) -> dict:
    with path.open(encoding='utf-8') as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise RuntimeError(f'Expected a JSON object: {path}')
    return value


def extension_id(override: str | None) -> str:
    manifest = read_json(ROOT / 'extension/manifest.json')
    if override:
        result = override
    else:
        try:
            public_key = base64.b64decode(manifest['key'], validate=True)
        except (KeyError, ValueError, TypeError) as error:
            raise RuntimeError('manifest.json has no valid public key; provide the ID shown in chrome://extensions with --extension-id.') from error
        digest = hashlib.sha256(public_key).digest()[:16]
        result = ''.join(chr(ord('a') + (nibble & 15)) for byte in digest for nibble in (byte >> 4, byte))
    if not re.fullmatch(r'[a-p]{32}', result):
        raise RuntimeError('Extension IDs must contain exactly 32 lowercase letters a–p.')
    return result


def app_identifier(path: Path) -> str | None:
    try:
        value = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
        return value.get('CFBundleIdentifier') if isinstance(value, dict) else None
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None


def native_version() -> str | None:
    if not APP.exists():
        return None
    try:
        value = plistlib.loads((APP / 'Contents/Info.plist').read_bytes())
        version = value.get('CFBundleShortVersionString') if isinstance(value, dict) else None
        return version if isinstance(version, str) else None
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None


def native_version_supported(version: str | None) -> bool:
    if not version or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,3}', version):
        return False
    parts = tuple(int(value) for value in version.split('.'))
    return parts + (0,) * max(0, 3 - len(parts)) >= MIN_NATIVE_VERSION


def check_destinations() -> None:
    for path in (APP, HOST, SUPPORT, WRAPPER, UI, MARKER):
        if path.is_symlink():
            raise RuntimeError(f'Refusing a symbolic-link destination: {path}')
    if APP.exists() and (not APP.is_dir() or app_identifier(APP) != APP_ID):
        raise RuntimeError(f'An unrelated item already occupies the app destination: {APP}')
    if SUPPORT.exists() and not SUPPORT.is_dir():
        raise RuntimeError(f'Application Support destination is not a directory: {SUPPORT}')
    if HOST.exists():
        existing = read_json(HOST)
        expected_paths = {str(WRAPPER), str(APP / 'Contents/MacOS/TabPalette')}
        if existing.get('name') != HOST_NAME or existing.get('type') != 'stdio' or existing.get('path') not in expected_paths:
            raise RuntimeError(f'Refusing to overwrite an unrelated native-host manifest: {HOST}')
    if MARKER.exists() and read_json(MARKER).get('app_id') != APP_ID:
        raise RuntimeError(f'Refusing an unrelated installation marker: {MARKER}')
    # Legacy versions predate the marker but have this exact host manifest.
    owned = MARKER.exists() or HOST.exists()
    if not owned and (WRAPPER.exists() or UI.exists()):
        raise RuntimeError('Unrecognized existing Tab Palette UI/host files. Move them aside before installing.')


def running_hosts() -> list[int]:
    if sys.platform != 'darwin':
        return []
    output = subprocess.run(['/bin/ps', '-axo', 'pid=,comm='], check=True, capture_output=True, text=True).stdout
    expected = str(APP / 'Contents/MacOS/TabPalette')
    pids = []
    for line in output.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] == expected:
            pids.append(int(parts[0]))
    return pids


def prerequisites(needs_build: bool) -> list[str]:
    errors = []
    if sys.platform != 'darwin':
        return ['The native companion supports macOS only. The Chrome extension can still be used without it.']
    version = platform.mac_ver()[0]
    if version and tuple(int(n) for n in version.split('.')[:2]) < (14, 0):
        errors.append('macOS 14 or newer is required.')
    for path in ['/usr/bin/ditto', '/usr/bin/codesign']:
        if not Path(path).is_file():
            errors.append(f'Required macOS tool is missing: {path}')
    if needs_build:
        probe = subprocess.run(['/usr/bin/xcrun', '--find', 'swiftc'], capture_output=True, text=True)
        if probe.returncode:
            errors.append('Swift/Xcode command-line tools are required. Install them with xcode-select --install.')
    return errors


def remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def private_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)


class Transaction:
    """Keep old paths beside their replacements so rollback stays on-volume."""
    def __init__(self):
        self.changes: list[tuple[Path, Path | None]] = []

    def replace(self, source: Path, target: Path) -> None:
        previous = target.parent / ('.tab-palette-previous-' + uuid.uuid4().hex) if target.exists() else None
        if previous is not None:
            os.replace(target, previous)
        self.changes.append((target, previous))
        os.replace(source, target)

    def delete(self, target: Path) -> None:
        if not target.exists():
            return
        previous = target.parent / ('.tab-palette-previous-' + uuid.uuid4().hex)
        os.replace(target, previous)
        self.changes.append((target, previous))

    def rollback(self) -> None:
        for target, previous in reversed(self.changes):
            remove_path(target)
            if previous is not None and previous.exists():
                os.replace(previous, target)
        self.changes.clear()

    def finish(self) -> None:
        for _, previous in self.changes:
            if previous is not None:
                remove_path(previous)
        self.changes.clear()


def backup_existing() -> Path | None:
    existing = [(name, path) for name, path in [('companion', APP), ('manifest.json', HOST), ('native-host', WRAPPER), ('ui', UI), ('installation.json', MARKER)] if path.exists()]
    if not existing:
        return None
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    backup = SUPPORT / 'backups' / stamp
    backup.mkdir(parents=True, mode=0o700)
    for name, path in existing:
        destination = backup / name
        if path.is_dir():
            subprocess.run(['/usr/bin/ditto', '--norsrc', '--noextattr', str(path), str(destination)], check=True)
        else:
            shutil.copy2(path, destination)
    return backup


def install(extension: str, rebuild: bool) -> None:
    needs_build = not APP.exists() or rebuild
    with tempfile.TemporaryDirectory(prefix='tab-palette-build-') as temporary:
        build = Path(temporary)
        stage = build / 'TabPaletteBundle'
        if needs_build:
            environment = {**os.environ, 'TAB_PALETTE_BUILD_DIR': str(build), 'TAB_PALETTE_APP_OUTPUT': '', 'PYTHON': sys.executable}
            subprocess.run(['/bin/bash', str(ROOT / 'companion/build.sh')], check=True, env=environment)
            if not (stage / 'Contents/MacOS/TabPalette').is_file():
                raise RuntimeError('The native build did not produce its executable.')
            # This mode has no visible window, native port, Accessibility check,
            # event tap, activation, or settings changes.
            subprocess.run([str(stage / 'Contents/MacOS/TabPalette'), '--self-test'], check=True)
        else:
            subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(APP)], check=True)

        APP.parent.mkdir(parents=True, exist_ok=True)
        HOST.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.tab-palette-app-', dir=APP.parent) as app_temp, tempfile.TemporaryDirectory(prefix='.tab-palette-ui-', dir=SUPPORT) as ui_temp, tempfile.TemporaryDirectory(prefix='.tab-palette-host-', dir=HOST.parent) as host_temp:
            app_candidate = Path(app_temp) / 'TabPaletteBundle'
            if needs_build:
                subprocess.run(['/usr/bin/ditto', '--norsrc', '--noextattr', str(stage), str(app_candidate)], check=True)
                subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(app_candidate)], check=True)
            prepared = Path(ui_temp)
            ui_candidate = prepared / 'ui'
            shutil.copytree(ROOT / 'extension', ui_candidate, ignore=shutil.ignore_patterns('__pycache__', '.DS_Store'))
            subprocess.run([sys.executable, str(ROOT / 'companion/bundle_native.py'), str(ui_candidate)], check=True)
            ui_candidate.chmod(0o700)
            wrapper_candidate = prepared / 'native-host'
            wrapper_candidate.write_text('#!/bin/sh\nexport TAB_PALETTE_ASSET_DIR=' + shlex.quote(str(UI)) + '\nexec ' + shlex.quote(str(APP / 'Contents/MacOS/TabPalette')) + ' "$@"\n', encoding='utf-8')
            wrapper_candidate.chmod(0o700)
            host_candidate = Path(host_temp) / 'manifest.json'
            private_json(host_candidate, {'name': HOST_NAME, 'description': 'Tab Palette local macOS companion', 'path': str(WRAPPER), 'type': 'stdio', 'allowed_origins': [f'chrome-extension://{extension}/']})
            marker_candidate = prepared / 'installation.json'
            private_json(marker_candidate, {'app_id': APP_ID, 'extension_id': extension, 'app': str(APP), 'native_host': str(HOST), 'ui': str(UI), 'installer_version': 2})
            backup = backup_existing()
            transaction = Transaction()
            try:
                if needs_build:
                    transaction.replace(app_candidate, APP)
                    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(APP)], check=True)
                transaction.replace(ui_candidate, UI)
                transaction.replace(wrapper_candidate, WRAPPER)
                transaction.replace(host_candidate, HOST)
                transaction.replace(marker_candidate, MARKER)
            except BaseException:
                transaction.rollback()
                raise
            transaction.finish()
    print('Installed the native host and private UI cache. Reload the extension in chrome://extensions to reconnect.')
    if needs_build:
        print('The locally built companion uses an ad-hoc signature. Add the installed app to Accessibility; after a native rebuild, remove and re-add its old Accessibility entry if macOS retains the previous code hash.')
    else:
        print('The existing signed companion and its Accessibility identity were preserved.')
    if backup:
        print(f'Previous installation backup: {backup}')


def uninstall() -> None:
    backup = backup_existing()
    transaction = Transaction()
    try:
        for path in [HOST, WRAPPER, UI, APP, MARKER]:
            transaction.delete(path)
    except BaseException:
        transaction.rollback()
        raise
    transaction.finish()
    print('Removed the native host, private UI cache, and companion. Remove/disable the Chrome extension separately.')
    print('Accessibility entries are managed by macOS; remove the Tab Palette entry in System Settings if it remains.')
    if backup:
        print(f'Recoverable backup retained at: {backup}')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply the displayed plan; without this flag no files are changed')
    parser.add_argument('--extension-id', help='Override the ID derived from the extension manifest public key')
    parser.add_argument('--rebuild-native', action='store_true', help='Rebuild the helper; UI-only updates preserve its Accessibility identity by default')
    parser.add_argument('--uninstall', action='store_true', help='Plan removal of the companion/host; add --apply to remove them')
    args = parser.parse_args()
    if args.uninstall and args.rebuild_native:
        parser.error('--uninstall and --rebuild-native cannot be combined')
    try:
        extension = extension_id(args.extension_id)
        check_destinations()
        needs_build = not args.uninstall and (not APP.exists() or args.rebuild_native)
        issues = prerequisites(needs_build)
        installed_version = native_version()
        if APP.exists() and not args.uninstall and not args.rebuild_native and not native_version_supported(installed_version):
            issues.append('Native upgrade required: the installed helper is older than protocol 1.1.0 or has no version. Disable the extension, then run --apply --rebuild-native; remove/re-add the installed app in Accessibility afterward to approve the new code hash.')
        pids = running_hosts()
        if pids and (args.uninstall or args.rebuild_native):
            issues.append('The native companion is running. Disable the extension or close Chrome before removing/rebuilding it; the installer never kills browser processes.')
        plan = {'operation': 'uninstall' if args.uninstall else 'install/update', 'apply': args.apply, 'extension_folder': str(ROOT / 'extension'), 'extension_id': extension, 'companion_destination': str(APP), 'native_host_manifest': str(HOST), 'private_ui_cache': str(UI), 'native_build_required': needs_build, 'installed_native_version': installed_version, 'minimum_native_version': '.'.join(map(str, MIN_NATIVE_VERSION)), 'running_companion_pids': pids, 'issues': issues, 'backups': str(SUPPORT / 'backups')}
        print(json.dumps(plan, indent=2))
        if not args.apply:
            print('Read-only plan. No files, permissions, browser settings, or running apps were changed.')
            return 0
        if issues:
            raise RuntimeError('Resolve the plan issues before applying: ' + '; '.join(issues))
        SUPPORT.mkdir(parents=True, exist_ok=True, mode=0o700)
        SUPPORT.chmod(0o700)
        import fcntl
        with (SUPPORT / '.install.lock').open('a', encoding='utf-8') as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
            check_destinations()
            if running_hosts() and (args.uninstall or args.rebuild_native):
                raise RuntimeError('The companion started after planning. Disable the extension before removing/rebuilding it.')
            if args.uninstall:
                uninstall()
            else:
                install(extension, args.rebuild_native)
        return 0
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
