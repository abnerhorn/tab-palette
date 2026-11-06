"""Installer safety checks using disposable fixtures only; never calls --apply."""
from contextlib import ExitStack, redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest import mock

PACKAGE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('tab_palette_installer', PACKAGE / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='tab-palette-installer-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        support = self.root / 'support'
        self.paths = {
            'APP': self.root / 'Applications/Tab Palette Companion.app',
            'HOST': self.root / 'hosts/ai.tesar.tab_palette.json',
            'SUPPORT': support,
            'WRAPPER': support / 'native-host',
            'UI': support / 'ui',
            'MARKER': support / 'installation.json',
        }
        stack = ExitStack()
        self.addCleanup(stack.close)
        for name, value in self.paths.items():
            stack.enter_context(mock.patch.object(installer, name, value))

    def test_default_id_is_derived_from_public_manifest_key(self):
        self.assertEqual(installer.extension_id(None), 'kbpdjjioplffgdanficjaoccbhlkjfcg')
        self.assertEqual(installer.extension_id('a' * 32), 'a' * 32)
        for invalid in ['a' * 31, 'q' * 32, '../native-host', 'A' * 32]:
            with self.subTest(invalid=invalid), self.assertRaises(RuntimeError):
                installer.extension_id(invalid)

    def test_unrelated_app_is_not_overwritten(self):
        info = self.paths['APP'] / 'Contents/Info.plist'
        info.parent.mkdir(parents=True)
        info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'org.example.unrelated'}))
        with self.assertRaisesRegex(RuntimeError, 'unrelated'):
            installer.check_destinations()
        self.assertEqual(plistlib.loads(info.read_bytes())['CFBundleIdentifier'], 'org.example.unrelated')

    def test_symbolic_link_destination_is_refused(self):
        target = self.root / 'somewhere-else'
        target.mkdir()
        self.paths['APP'].parent.mkdir()
        self.paths['APP'].symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symbolic-link'):
            installer.check_destinations()
        self.assertTrue(target.is_dir())

    def test_unrelated_native_manifest_is_refused(self):
        host = self.paths['HOST']
        host.parent.mkdir()
        host.write_text(json.dumps({'name': installer.HOST_NAME, 'type': 'stdio', 'path': '/unrelated/program'}))
        with self.assertRaisesRegex(RuntimeError, 'unrelated native-host'):
            installer.check_destinations()

    def test_unknown_ui_files_are_not_replaced(self):
        self.paths['UI'].mkdir(parents=True)
        (self.paths['UI'] / 'keep.txt').write_text('unrelated local file')
        with self.assertRaisesRegex(RuntimeError, 'Unrecognized'):
            installer.check_destinations()

    def test_failure_rolls_back_prior_and_current_replacements(self):
        first = self.root / 'first'
        first.mkdir()
        (first / 'value').write_text('original')
        prepared = self.root / 'prepared'
        prepared.mkdir()
        (prepared / 'value').write_text('replacement')
        second = self.root / 'second'
        second.write_text('also original')
        transaction = installer.Transaction()
        transaction.replace(prepared, first)
        with self.assertRaises(OSError):
            transaction.replace(self.root / 'missing-source', second)
        transaction.rollback()
        self.assertEqual((first / 'value').read_text(), 'original')
        self.assertEqual(second.read_text(), 'also original')
        self.assertFalse(any(self.root.glob('.tab-palette-previous-*')))

    def test_default_plan_creates_nothing(self):
        output = io.StringIO()
        with mock.patch('sys.argv', ['install.py']), mock.patch.object(installer, 'prerequisites', return_value=[]), mock.patch.object(installer, 'running_hosts', return_value=[]), redirect_stdout(output):
            self.assertEqual(installer.main(), 0)
        self.assertIn('"apply": false', output.getvalue())
        self.assertIn('Read-only plan', output.getvalue())
        for path in self.paths.values():
            self.assertFalse(path.exists(), str(path))

    def test_old_native_helper_requires_deliberate_rebuild(self):
        info = self.paths['APP'] / 'Contents/Info.plist'
        info.parent.mkdir(parents=True)
        info.write_bytes(plistlib.dumps({'CFBundleIdentifier': installer.APP_ID, 'CFBundleShortVersionString': '1.0.0'}))
        output = io.StringIO()
        with mock.patch('sys.argv', ['install.py']), mock.patch.object(installer, 'prerequisites', return_value=[]), mock.patch.object(installer, 'running_hosts', return_value=[]), redirect_stdout(output):
            self.assertEqual(installer.main(), 0)
        self.assertIn('Native upgrade required', output.getvalue())
        self.assertIn('--apply --rebuild-native', output.getvalue())
        self.assertFalse(self.paths['SUPPORT'].exists())

    def test_native_version_guard_allows_future_ui_only_updates(self):
        self.assertFalse(installer.native_version_supported(None))
        self.assertFalse(installer.native_version_supported('unknown'))
        self.assertFalse(installer.native_version_supported('1.0.99'))
        self.assertTrue(installer.native_version_supported('1.1'))
        self.assertTrue(installer.native_version_supported('1.1.0'))
        self.assertTrue(installer.native_version_supported('1.2.0'))


if __name__ == '__main__':
    unittest.main()
