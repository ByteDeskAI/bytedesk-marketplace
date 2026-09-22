#!/usr/bin/env python3
"""Deterministic fake-filesystem tests; never touch systemd or real cgroups."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('containment', Path(__file__).with_name('containment.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ContainmentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / 'home'
        self.home.mkdir(mode=0o700)
        self.cg = Path(self.tmp.name) / 'cg'
        self.cg.mkdir()
        self.root = self.cg / 'unit'
        self.root.mkdir()
        self.plugins = self.root / 'plugins'
        self.plugins.mkdir()
        for group in (self.root, self.plugins):
            for name, value in {'cgroup.controllers': 'cpu memory pids',
                                'cgroup.subtree_control': 'cpu memory pids',
                                'cgroup.procs': '', 'cgroup.type': 'domain',
                                'cgroup.kill': '', 'cgroup.events': 'populated 0'}.items():
                (group / name).write_text(value)
        self.unit = m.UNITS[0]
        self.lease = self.home / 'plugin-cgroup-v1.json'
        self.lease.write_text(json.dumps(m.identity(self.unit, self.root, self.plugins)))
        self.lease.chmod(0o600)

    def hooks(self):
        stack = contextlib.ExitStack()
        stack.enter_context(patch.object(m, 'unit_root', return_value=self.root))
        stack.enter_context(patch.object(m, 'own_membership', return_value='fixture'))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        return stack

    def test_prepare_readback_and_lease(self):
        original = m.read
        def kernel_read(path):
            value = original(path)
            return value.replace('+', '') if Path(path).name == 'cgroup.subtree_control' else value
        with self.hooks(), patch.object(m, 'read', side_effect=kernel_read):
            m.prepare(self.unit, self.home)
        self.assertEqual((self.plugins / 'cgroup.subtree_control').read_text(), '+cpu +memory +pids')
        m.match_lease(self.lease, self.unit, self.root, self.plugins)

    def test_new_reserved_subtree_gets_private_identity(self):
        for file in self.plugins.iterdir():
            file.unlink()
        self.plugins.rmdir()
        self.lease.unlink()
        real_mkdir = Path.mkdir
        original_read = m.read
        def fake_mkdir(path, *args, **kwargs):
            real_mkdir(path, *args, **kwargs)
            if path == self.plugins:
                for name, value in {'cgroup.controllers': 'cpu memory pids', 'cgroup.subtree_control': '', 'cgroup.procs': '', 'cgroup.type': 'domain', 'cgroup.kill': ''}.items():
                    (path / name).write_text(value)
        def kernel_read(path):
            value = original_read(path)
            return value.replace('+', '') if Path(path).name == 'cgroup.subtree_control' else value
        with self.hooks(), patch.object(Path, 'mkdir', fake_mkdir), patch.object(m, 'read', side_effect=kernel_read):
            m.prepare(self.unit, self.home)
        self.assertEqual(self.lease.stat().st_mode & 0o777, 0o600)
        m.match_lease(self.lease, self.unit, self.root, self.plugins)

    def test_controller_readback_failure_not_prepared(self):
        output = io.StringIO()
        with patch.object(m, 'unit_root', return_value=self.root), patch.object(m, 'own_membership', return_value='fixture'), contextlib.redirect_stdout(output), self.assertRaisesRegex(ValueError, 'delegation-readback-failed'):
            # Fake plain files retain '+' tokens, unlike kernel readback.
            m.prepare(self.unit, self.home)
        self.assertNotIn('subtree=prepared', output.getvalue())

    def test_parent_internal_processes_refuse_without_migration(self):
        (self.root / 'cgroup.procs').write_text('123')
        with self.hooks(), self.assertRaisesRegex(ValueError, 'unit-root-has-processes'):
            m.prepare(self.unit, self.home)
        self.assertEqual((self.root / 'cgroup.procs').read_text(), '123')

    def test_missing_controller_refuses(self):
        (self.root / 'cgroup.controllers').write_text('memory pids')
        with self.hooks(), self.assertRaisesRegex(ValueError, 'controller-unavailable'):
            m.prepare(self.unit, self.home)

    def test_unknown_reserved_collision_never_killed(self):
        self.lease.unlink()
        with self.hooks(), self.assertRaises(OSError):
            m.cleanup(self.unit, self.home)
        self.assertEqual((self.plugins / 'cgroup.kill').read_text(), '')

    def test_mismatched_identity_never_killed(self):
        value = json.loads(self.lease.read_text())
        value['plugins_inode'] += 1
        self.lease.write_text(json.dumps(value))
        with self.hooks(), self.assertRaisesRegex(ValueError, 'identity-mismatch'):
            m.cleanup(self.unit, self.home)
        self.assertEqual((self.plugins / 'cgroup.kill').read_text(), '')

    def test_symlink_collision_never_killed(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.plugins, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'unsafe-directory'):
            m.match_lease(self.lease, self.unit, self.root, alias)

    def test_cleanup_only_reserved_subtree(self):
        host = self.root / 'host'
        host.mkdir()
        sentinel = host / 'cgroup.kill'
        sentinel.write_text('untouched')
        with self.hooks():
            m.cleanup(self.unit, self.home)
        self.assertEqual(sentinel.read_text(), 'untouched')
        self.assertEqual((self.plugins / 'cgroup.kill').read_text(), '1')
        # Retain the empty namespace/receipt; do not race successor rmdir/unlink.
        self.assertTrue(self.plugins.exists())
        self.assertTrue(self.lease.exists())
        m.match_lease(self.lease, self.unit, self.root, self.plugins)

    def test_cleanup_path_swap_after_validation_cannot_kill_sibling(self):
        sibling = self.root / 'sibling'
        sibling.mkdir()
        (sibling / 'cgroup.kill').write_text('untouched')
        (sibling / 'cgroup.events').write_text('populated 1')
        original = self.root / 'retired-owned'
        real_open = os.open
        swapped = False
        def swap_before_kill(path, flags, *args, **kwargs):
            nonlocal swapped
            if path == 'cgroup.kill' and flags & os.O_WRONLY:
                self.assertIsNotNone(kwargs.get('dir_fd'))
                self.plugins.rename(original)
                sibling.rename(self.plugins)
                swapped = True
            return real_open(path, flags, *args, **kwargs)
        with self.hooks(), patch.object(m.os, 'open', side_effect=swap_before_kill), self.assertRaisesRegex(ValueError, 'identity-mismatch'):
            m.cleanup(self.unit, self.home)
        self.assertTrue(swapped)
        self.assertEqual((self.plugins / 'cgroup.kill').read_text(), 'untouched')
        self.assertEqual((original / 'cgroup.kill').read_text(), '1')
        self.assertTrue(self.lease.exists())

    def test_cleanup_swap_before_validation_is_denied(self):
        old = self.root / 'old'
        self.plugins.rename(old)
        self.plugins.mkdir()
        (self.plugins / 'cgroup.kill').write_text('untouched')
        with self.hooks(), self.assertRaisesRegex(ValueError, 'identity-mismatch'):
            m.cleanup(self.unit, self.home)
        self.assertEqual((self.plugins / 'cgroup.kill').read_text(), 'untouched')
        self.assertEqual((old / 'cgroup.kill').read_text(), '')

    def test_cleanup_kill_symlink_is_denied(self):
        sentinel = self.root / 'sentinel'
        sentinel.write_text('untouched')
        (self.plugins / 'cgroup.kill').unlink()
        (self.plugins / 'cgroup.kill').symlink_to(sentinel)
        with self.hooks(), self.assertRaises(OSError):
            m.cleanup(self.unit, self.home)
        self.assertEqual(sentinel.read_text(), 'untouched')

    def test_teardown_timeout_retains_lease(self):
        (self.plugins / 'cgroup.events').write_text('populated 1')
        with self.hooks(), patch.object(m.time, 'monotonic', side_effect=[0, 3]), self.assertRaisesRegex(ValueError, 'teardown-timeout'):
            m.cleanup(self.unit, self.home)
        self.assertTrue(self.lease.exists())
        self.assertTrue(self.plugins.exists())

    def test_lease_mode_refused(self):
        self.lease.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'unsafe-lease'):
            m.load_lease(self.lease)

    def test_wrong_service_context_refused(self):
        for value in ('/system.slice/bytedesk-gateway.service/.control',
                      '/user.slice/user-0.slice/user@0.service/app.slice/bytedesk-gateway.service/host',
                      '/../../bytedesk-gateway.service/.control'):
            with self.assertRaises(ValueError):
                m.unit_root(self.unit, value)

    def test_doctor_unsupported_readonly(self):
        output = io.StringIO()
        with patch.object(m.platform, 'system', return_value='Darwin'), contextlib.redirect_stdout(output), patch.object(m, 'command') as command:
            m.doctor(self.home)
        command.assert_not_called()
        self.assertIn('unsupported-platform', output.getvalue())
        self.assertIn('activation=unverified', output.getvalue())

    def test_doctor_missing_unit_never_claims_activation(self):
        output = io.StringIO()
        before = {str(p): p.read_bytes() for p in self.home.iterdir()}
        with patch.object(m, 'command', return_value=''), contextlib.redirect_stdout(output):
            m.doctor(self.home)
        self.assertIn('containment_user_unit=unavailable', output.getvalue())
        self.assertIn('containment_activation=unverified', output.getvalue())
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.home.iterdir()})


if __name__ == '__main__':
    unittest.main()
