package main

// Per-project PID lock + stale reclaim. Mirrors the bash
// _try_acquire_pid_lock helper introduced for the notify daemon in BDM-4 so
// the web server uses the same semantics:
//
//	- File doesn't exist  → acquire (write our PID).
//	- File exists, empty  → reclaim (treat as stale).
//	- File exists, PID is dead (kill -0 fails)  → reclaim.
//	- File exists, PID is alive → blocked. Caller stands by.

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

type Lock struct {
	Path string
}

// TryAcquire returns (true, nil) if the lock was acquired (either fresh or
// reclaimed from a stale holder). Returns (false, nil) if a live peer holds
// the lock. Returns (_, err) only for unexpected I/O failures.
func (l *Lock) TryAcquire() (bool, error) {
	if data, err := os.ReadFile(l.Path); err == nil {
		s := strings.TrimSpace(string(data))
		if s != "" {
			if pid, perr := strconv.Atoi(s); perr == nil {
				if isAlive(pid) {
					return false, nil
				}
			}
		}
		// Empty file or non-numeric content: treat as stale.
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(l.Path), 0o755); err != nil {
		return false, err
	}
	pid := strconv.Itoa(os.Getpid())
	return true, os.WriteFile(l.Path, []byte(pid+"\n"), 0o644)
}

// Release removes the lock file. Idempotent.
func (l *Lock) Release() error {
	err := os.Remove(l.Path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// isAlive reports whether a process with the given PID exists and accepts
// signals. Posix-only; Windows would need a different check.
func isAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return proc.Signal(syscall.Signal(0)) == nil
}
