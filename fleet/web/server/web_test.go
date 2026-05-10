package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestHashedPortIsDeterministic(t *testing.T) {
	a := hashedPort("abc123def456")
	b := hashedPort("abc123def456")
	if a != b {
		t.Fatalf("expected deterministic hashed port, got %d vs %d", a, b)
	}
}

func TestHashedPortInRange(t *testing.T) {
	for _, k := range []string{"abc", "def", "deadbeefcafe", "", "fleet-marketplace"} {
		p := hashedPort(k)
		if p < portRangeStart || p >= portRangeStart+portRangeSize {
			t.Errorf("hashedPort(%q) = %d; out of [%d, %d)",
				k, p, portRangeStart, portRangeStart+portRangeSize)
		}
	}
}

func TestNextFreePortWalksOnConflict(t *testing.T) {
	// Bind a known port to force the function to walk.
	const target = portRangeStart + 5
	l, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", target))
	if err != nil {
		t.Skipf("cannot bind 127.0.0.1:%d (already in use?): %v", target, err)
	}
	defer l.Close()
	p := nextFreePort("127.0.0.1", target)
	if p == target {
		t.Errorf("expected a port other than %d, got %d", target, p)
	}
	if p == 0 {
		t.Error("expected a free port; got 0 (range exhausted)")
	}
}

func TestNextFreePortReturnsRequestedWhenFree(t *testing.T) {
	// Use a likely-free port within range.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	chosen := l.Addr().(*net.TCPAddr).Port
	l.Close()
	if chosen < portRangeStart || chosen >= portRangeStart+portRangeSize {
		// Ephemeral ports are typically 32K+; nothing to test here.
		t.Skipf("ephemeral pick %d outside our range; skipping", chosen)
	}
	got := nextFreePort("127.0.0.1", chosen)
	if got != chosen {
		t.Errorf("expected requested port %d when free; got %d", chosen, got)
	}
}

func TestLockAcquireOnEmptyPath(t *testing.T) {
	l := &Lock{Path: filepath.Join(t.TempDir(), "pid")}
	ok, err := l.TryAcquire()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected acquire on empty path")
	}
	data, _ := os.ReadFile(l.Path)
	if got, _ := strconv.Atoi(strings.TrimSpace(string(data))); got != os.Getpid() {
		t.Errorf("expected pid file to contain %d, got %q", os.Getpid(), data)
	}
}

func TestLockBlockedByLivePeer(t *testing.T) {
	l := &Lock{Path: filepath.Join(t.TempDir(), "pid")}
	// Simulate a peer holding the lock by writing this proc's PID.
	if err := os.WriteFile(l.Path, []byte(strconv.Itoa(os.Getpid())+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, err := l.TryAcquire()
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("expected blocked when live peer holds the lock")
	}
}

func TestLockReclaimsStalePID(t *testing.T) {
	l := &Lock{Path: filepath.Join(t.TempDir(), "pid")}
	const fakePID = 999999999
	if isAlive(fakePID) {
		t.Skip("fake PID is alive; cannot test stale-reclaim deterministically")
	}
	if err := os.WriteFile(l.Path, []byte(strconv.Itoa(fakePID)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, err := l.TryAcquire()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Error("expected stale-PID reclaim")
	}
	data, _ := os.ReadFile(l.Path)
	if got, _ := strconv.Atoi(strings.TrimSpace(string(data))); got != os.Getpid() {
		t.Errorf("expected pid rewrite to %d, got %q", os.Getpid(), data)
	}
}

func TestLockReclaimsEmptyPath(t *testing.T) {
	l := &Lock{Path: filepath.Join(t.TempDir(), "pid")}
	if err := os.WriteFile(l.Path, []byte(""), 0o644); err != nil {
		t.Fatal(err)
	}
	ok, err := l.TryAcquire()
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Error("expected reclaim on empty pid file")
	}
}

func TestParseAndFormatTOMLRoundTrip(t *testing.T) {
	in := &WebConfig{Port: 7690, Bind: "0.0.0.0", AuthToken: "secret"}
	s := formatTOML(in)
	out := &WebConfig{}
	parseTOML(s, out)
	if *out != *in {
		t.Errorf("round-trip mismatch: in=%+v out=%+v\nemitted:\n%s", in, out, s)
	}
}

func TestParseTOMLIgnoresOtherSections(t *testing.T) {
	s := `[other]
port = 9999

[web]
port = 7700
bind = "127.0.0.1"
auth_token = ""

[trailing]
port = 1
`
	c := &WebConfig{}
	parseTOML(s, c)
	if c.Port != 7700 || c.Bind != "127.0.0.1" {
		t.Errorf("expected web/port=7700 bind=127.0.0.1; got %+v", c)
	}
}

func TestProjectKeyDeterministic(t *testing.T) {
	// Two calls in the same cwd should yield the same key.
	a, err := projectKey()
	if err != nil {
		t.Fatal(err)
	}
	b, err := projectKey()
	if err != nil {
		t.Fatal(err)
	}
	if a != b {
		t.Errorf("expected stable project key, got %s vs %s", a, b)
	}
	if len(a) != 12 {
		t.Errorf("expected 12-char project key, got %d chars: %s", len(a), a)
	}
}
