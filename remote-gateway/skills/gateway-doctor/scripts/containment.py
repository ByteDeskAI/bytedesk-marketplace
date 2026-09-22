#!/usr/bin/env python3
"""Gateway delegated subtree v1. Doctor is read-only; hooks run only in the unit."""
import contextlib
import json
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
import time

PROFILE = 'linux-bwrap-cgv2-v1'
UNITS = ('bytedesk-gateway.service', 'bytedesk-emote-gateway.service')
CONTROLLERS = {'cpu', 'memory', 'pids'}
CGROOT = Path('/sys/fs/cgroup')


def read(path):
    return Path(path).read_text().strip()


def checked_dir(path):
    # Never follow a name collision into an unrelated subtree.
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or path.resolve() != path:
        raise ValueError('unsafe-directory')
    return path


def unit_root(unit, membership):
    if unit not in UNITS:
        raise ValueError('user-service-required')
    parts = Path(membership).parts
    if '..' in parts or '.' in parts:
        raise ValueError('invalid-cgroup-path')
    prefix = '/user.slice/user-%d.slice/user@%d.service/' % (os.getuid(), os.getuid())
    if not membership.startswith(prefix) or not membership.endswith('/' + unit + '/.control'):
        raise ValueError('unit-control-process-required')
    return checked_dir(CGROOT / membership.lstrip('/')).parent


def own_membership():
    entries = [line[3:] for line in read('/proc/self/cgroup').splitlines() if line.startswith('0::')]
    if len(entries) != 1:
        raise ValueError('cgroup-v2-required')
    return entries[0]


def lease_path(home):
    home = checked_dir(Path(home).absolute())
    info = home.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        raise ValueError('unsafe-home-owner-mode')
    return home / 'plugin-cgroup-v1.json'


def identity(unit, root, plugins):
    return dict(version=1, profile=PROFILE, unit=unit,
                boot=read('/proc/sys/kernel/random/boot_id'),
                root=str(root), root_inode=root.stat().st_ino,
                plugins_inode=plugins.stat().st_ino, uid=os.getuid())


def load_lease(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('unsafe-lease')
        return json.load(stream)


def match_lease(path, unit, root, plugins):
    checked_dir(root)
    checked_dir(plugins)
    if load_lease(path) != identity(unit, root, plugins):
        raise ValueError('reserved-subtree-identity-mismatch')


def require_controllers(root):
    if not CONTROLLERS <= set(read(root / 'cgroup.controllers').split()):
        raise ValueError('controller-unavailable')
    if read(root / 'cgroup.procs'):
        raise ValueError('unit-root-has-processes')
    if read(root / 'cgroup.type') != 'domain':
        raise ValueError('domain-cgroup-required')


def prepare(unit, home):
    root = unit_root(unit, own_membership())
    require_controllers(root)
    path = lease_path(home)
    plugins = root / 'plugins'
    if plugins.exists() or plugins.is_symlink():
        match_lease(path, unit, root, plugins)
    else:
        plugins.mkdir()  # Exclusive reserved-name creation; never adopt a collision.
        try:
            value = identity(unit, root, plugins)
            # A private atomic receipt may replace a stale prior-boot receipt.
            tmp = path.with_name(path.name + '.new')
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as out:
                json.dump(value, out)
                out.flush()
                os.fsync(out.fileno())
            os.replace(tmp, path)
        except Exception:
            plugins.rmdir()
            raise
    require_controllers(root)
    (root / 'cgroup.subtree_control').write_text('+cpu +memory +pids')
    require_controllers(plugins)
    (plugins / 'cgroup.subtree_control').write_text('+cpu +memory +pids')
    for group in (root, plugins):
        if not CONTROLLERS <= set(read(group / 'cgroup.subtree_control').split()):
            raise ValueError('delegation-readback-failed')
    if not (plugins / 'cgroup.kill').is_file():
        raise ValueError('cgroup-kill-required')
    print('containment_subtree=prepared activation=unverified')


def open_directory(path):
    """Pin every path component without following symlinks."""
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('unsafe-directory')
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    fd = os.open('/', flags)
    try:
        for name in path.parts[1:]:
            child = os.open(name, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_at(directory, name):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    with os.fdopen(fd) as stream:
        return stream.read().strip()


def cleanup(unit, home):
    root = unit_root(unit, own_membership())
    with contextlib.ExitStack() as handles:
        root_fd = open_directory(root)
        handles.callback(os.close, root_fd)
        try:
            plugins_fd = os.open('plugins', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd)
        except FileNotFoundError:
            print('containment_cleanup=absent')
            return
        handles.callback(os.close, plugins_fd)
        expected = dict(version=1, profile=PROFILE, unit=unit,
                        boot=read('/proc/sys/kernel/random/boot_id'), root=str(root),
                        root_inode=os.fstat(root_fd).st_ino,
                        plugins_inode=os.fstat(plugins_fd).st_ino, uid=os.getuid())
        if load_lease(lease_path(home)) != expected:
            raise ValueError('reserved-subtree-identity-mismatch')
        # Validation and the destructive open use the SAME pinned directory.
        # Renaming/replacing 'plugins' cannot redirect this write to a sibling.
        kill_fd = os.open('cgroup.kill', os.O_WRONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=plugins_fd)
        handles.callback(os.close, kill_fd)
        if os.write(kill_fd, b'1') != 1:
            raise ValueError('teardown-write-failed')
        deadline = time.monotonic() + 2
        while 'populated 0' not in read_at(plugins_fd, 'cgroup.events').splitlines():
            if time.monotonic() >= deadline:
                raise ValueError('teardown-timeout')
            time.sleep(0.02)
        named = os.stat('plugins', dir_fd=root_fd, follow_symlinks=False)
        pinned = os.fstat(plugins_fd)
        if (named.st_dev, named.st_ino) != (pinned.st_dev, pinned.st_ino):
            raise ValueError('reserved-subtree-identity-mismatch')
        # Linux has no inode-conditional rmdir/unlink. Retain the empty reserved
        # hierarchy and its receipt rather than racing name-based removal of a
        # successor. prepare() already accepts this exact owned empty subtree.
        print('containment_cleanup=empty-reserved-root-retained')


def command(args):
    try:
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                text=True, timeout=3, check=True)
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''


def doctor(home):
    print('containment_profile=' + PROFILE)
    print('containment_activation=unverified')
    if platform.system() != 'Linux':
        print('containment_prerequisite=unsupported-platform')
        return
    unified = (CGROOT / 'cgroup.controllers').is_file()
    print('containment_cgroup_v2=' + ('present' if unified else 'missing'))
    version = command(['systemctl', '--version']).split()
    print('containment_systemd_version=' + (version[1] if len(version) > 1 and version[1].isdecimal() else 'unavailable'))
    selected = None
    properties = {}
    for unit in UNITS:
        raw = command(['systemctl', '--user', 'show', unit, '--no-pager',
                       '--property=Id,LoadState,ActiveState,ControlGroup,Delegate,DelegateControllers,DelegateSubgroup,MainPID'])
        props = dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)
        if props.get('Id') == unit and props.get('ActiveState') == 'active':
            selected, properties = unit, props
            break
    print('containment_user_unit=' + (selected or 'unavailable'))
    delegation = properties.get('Delegate') == 'yes' and CONTROLLERS <= set(properties.get('DelegateControllers', '').split())
    print('containment_delegation=' + ('configured' if delegation else 'unavailable'))
    print('containment_delegate_subgroup=' + ('host' if properties.get('DelegateSubgroup') == 'host' else 'unavailable'))
    health = 'unavailable'
    controllers = 'unavailable'
    kill = 'unavailable'
    kernel_kill = 'unverified'
    main_identity = 'unverified'
    subtree_reason = 'user-service-required'
    if selected and unified:
        try:
            cg = properties.get('ControlGroup', '')
            prefix = '/user.slice/user-%d.slice/user@%d.service/' % (os.getuid(), os.getuid())
            if not cg.startswith(prefix) or not cg.endswith('/' + selected) or '..' in Path(cg).parts:
                raise ValueError('unit-identity-mismatch')
            root = checked_dir(CGROOT / cg.lstrip('/'))
            kernel_kill = 'present-at-unit' if (root / 'cgroup.kill').is_file() else 'missing-at-unit'
            require_controllers(root)
            controllers = 'available' if CONTROLLERS <= set(read(root / 'cgroup.subtree_control').split()) and os.access(root / 'cgroup.subtree_control', os.W_OK) else 'not-enabled-or-writable'
            pid = int(properties.get('MainPID', '0'))
            if pid > 0 and '0::' + cg + '/host' in read('/proc/%d/cgroup' % pid).splitlines():
                main_identity = 'host-subgroup-matched'
            plugins = root / 'plugins'
            kill = 'present' if (plugins / 'cgroup.kill').is_file() else 'missing'
            if not plugins.exists():
                health = 'absent'
            else:
                match_lease(lease_path(home), selected, root, plugins)
                controls = CONTROLLERS <= set(read(plugins / 'cgroup.subtree_control').split())
                health = 'owned-empty' if 'populated 0' in read(plugins / 'cgroup.events').splitlines() else 'owned-populated-runtime-review-required'
                if not controls:
                    health = 'owned-controllers-unavailable'
        except (OSError, ValueError, KeyError) as exc:
            health = 'unverified-or-mismatched'
            subtree_reason = str(exc) if isinstance(exc, ValueError) and str(exc) in {'unit-root-has-processes', 'controller-unavailable', 'domain-cgroup-required', 'unsafe-directory', 'unsafe-lease', 'unsafe-home-owner-mode', 'reserved-subtree-identity-mismatch'} else 'ownership-or-delegation-unverified'
        else:
            subtree_reason = 'read-only-check-complete'
    print('containment_main_identity=' + main_identity)
    print('containment_controllers=' + controllers)
    print('containment_cgroup_kill=' + kill)
    print('containment_cgroup_kill_kernel=' + kernel_kill)
    print('containment_reserved_subtree=' + health)
    print('containment_subtree_reason=' + subtree_reason)
    help_text = command(['bwrap', '--help']) if shutil.which('bwrap') else ''
    flags = ('--unshare-user', '--unshare-pid', '--unshare-cgroup', '--unshare-net', '--info-fd')
    print('containment_bubblewrap=' + ('flags-present-execution-unverified' if all(f in help_text for f in flags) else 'missing-or-incompatible'))
    for namespace in ('user', 'mnt', 'pid'):
        print('containment_namespace_' + namespace + '=' + ('present-execution-unverified' if Path('/proc/self/ns/' + namespace).exists() else 'missing'))
    for key, file in [('userns_limit', '/proc/sys/user/max_user_namespaces'),
                      ('unprivileged_userns', '/proc/sys/kernel/unprivileged_userns_clone'),
                      ('apparmor_userns', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns')]:
        try:
            value = read(file)
            value = value if value.isdecimal() else 'unverified'
        except OSError:
            value = 'unavailable'
        print('containment_' + key + '=' + value)
    pidfd = 'unavailable'
    if hasattr(os, 'pidfd_open'):
        try:
            fd = os.pidfd_open(os.getpid())
            os.close(fd)
            pidfd = 'self-open-verified'
        except OSError:
            pass
    print('containment_pidfd=' + pidfd)
    print('containment_sandbox_execution=not-probed-read-only')


def main():
    if len(sys.argv) == 3 and sys.argv[1] == 'doctor':
        doctor(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] in ('prepare', 'cleanup'):
        if platform.system() != 'Linux':
            raise ValueError('unsupported-platform')
        if not (CGROOT / 'cgroup.controllers').is_file():
            raise ValueError('cgroup-v2-required')
        (prepare if sys.argv[1] == 'prepare' else cleanup)(sys.argv[2], sys.argv[3])
    else:
        raise ValueError('invalid-operation')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Never print environment values, paths, exception text or process payload.
        reason = str(exc) if isinstance(exc, ValueError) and str(exc) in {
            'user-service-required', 'unit-control-process-required', 'controller-unavailable',
            'unit-root-has-processes', 'domain-cgroup-required', 'delegation-readback-failed',
            'cgroup-kill-required', 'teardown-timeout', 'unsupported-platform', 'cgroup-v2-required',
            'reserved-subtree-identity-mismatch', 'unsafe-lease', 'unsafe-home-owner-mode',
            'unsafe-directory'} else 'prerequisite-or-ownership-unverified'
        print('containment_prerequisite=' + reason, file=sys.stderr)
        sys.exit(1)
