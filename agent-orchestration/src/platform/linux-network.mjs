import { invariant } from "../errors.mjs";

// Bubblewrap can move its child into a second user namespace after reporting
// --info-fd. The network namespace still belongs to the first one. Pin that
// owner through NS_GET_USERNS instead of racing /proc/<child>/ns/user.
// This fixed program uses only Python's standard library; -I excludes user
// startup paths. It never changes host policy or executes caller-supplied code.
const NETWORK_LAUNCHER = String.raw`
import fcntl
import os
import sys
import time

def main():
    if len(sys.argv) != 3:
        raise ValueError("Expected the owned Bubblewrap child PID and network namespace inode.")
    pid, expected_net = map(int, sys.argv[1:])
    if pid <= 0 or expected_net <= 0:
        raise ValueError("Bubblewrap child PID and network namespace inode must be positive.")
    net = os.open("/proc/%d/ns/net" % pid, os.O_RDONLY | os.O_CLOEXEC)
    if os.fstat(net).st_ino != expected_net:
        raise ValueError("Bubblewrap network namespace identity changed; refusing to attach.")
    if os.stat("/proc/self/ns/net").st_ino == expected_net:
        raise ValueError("Refusing to attach the provider network to the host namespace.")
    # Linux nsfs.h: NS_GET_USERNS = _IO(0xb7, 0x1). The returned descriptor
    # pins the owner even when no process remains in that user namespace.
    owner = fcntl.ioctl(net, 0xb701)
    if os.fstat(owner).st_ino == os.stat("/proc/self/ns/user").st_ino:
        raise ValueError("Provider network must belong to a separate user namespace.")
    # --info-fd may precede Bubblewrap's initial ID mapping as well. Both
    # mappings must exist before nsenter can preserve the mapped credentials.
    deadline = time.monotonic() + 5
    while True:
        with open("/proc/%d/uid_map" % pid) as uid_map, open("/proc/%d/gid_map" % pid) as gid_map:
            if uid_map.read().strip() and gid_map.read().strip():
                break
        if time.monotonic() >= deadline:
            raise ValueError("Timed out waiting for Bubblewrap's user namespace mappings.")
        time.sleep(.01)
    for executable in ("/usr/bin/nsenter", "/usr/bin/slirp4netns"):
        if not os.access(executable, os.X_OK):
            raise ValueError("Required Linux sandbox executable is missing: " + executable)
    os.set_inheritable(net, True)
    os.set_inheritable(owner, True)
    user_path = "/proc/self/fd/%d" % owner
    net_path = "/proc/self/fd/%d" % net
    # Enter only the helper's owning user namespace. slirp keeps host networking
    # for outbound traffic and creates its own mount sandbox. Pre-entry also
    # avoids slirp 1.2.x's second, PID-based userns lookup in --enable-sandbox.
    os.execv("/usr/bin/nsenter", [
        "/usr/bin/nsenter", "--user=" + user_path,
        "--preserve-credentials", "--no-fork", "--",
        "/usr/bin/slirp4netns", "--netns-type=path", "--userns-path=" + user_path,
        "--configure", "--mtu=65520", "--disable-host-loopback", "--enable-sandbox",
        "--ready-fd=3", "--exit-fd=4", net_path, "tap0",
    ])

try:
    main()
except (OSError, ValueError) as error:
    print("[agent-orchestration-network] Namespace attachment failed: %s. "
          "Linux requires /usr/bin/python3, /usr/bin/nsenter, slirp4netns, "
          "and NS_GET_USERNS support (Linux 4.9 or newer)." % error, file=sys.stderr)
    sys.exit(1)
`;

export function linuxNetworkCommand(info) {
  // Only the --info-fd stream of the caller's newly spawned bwrap may supply
  // this record. The launcher verifies and pins the reported network identity.
  const pid = info?.["child-pid"];
  const inode = info?.["net-namespace"];
  invariant(Number.isSafeInteger(pid) && pid > 0, "AO_SANDBOX_NAMESPACE_IDENTITY_MISSING", "Bubblewrap did not report a valid owned child PID.");
  invariant(Number.isSafeInteger(inode) && inode > 0, "AO_SANDBOX_NAMESPACE_IDENTITY_MISSING", "Bubblewrap did not report its network namespace inode; refusing an unbound network attachment.");
  return {
    executable: "/usr/bin/python3",
    args: ["-I", "-c", NETWORK_LAUNCHER, String(pid), String(inode)],
  };
}
