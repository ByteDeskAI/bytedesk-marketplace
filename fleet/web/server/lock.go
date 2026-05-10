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
	"time"
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

// HolderInfo returns the lock holder's PID and whether it's a live
// process. Used by the launch path to decide whether to defer to an
// existing server (same build) or preempt + take over (different
// build / dead peer). Returns (0, false) when the lock file doesn't
// exist or contains a dead/invalid PID.
func (l *Lock) HolderInfo() (int, bool) {
	data, err := os.ReadFile(l.Path)
	if err != nil {
		return 0, false
	}
	s := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(s)
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, isAlive(pid)
}

// AcquirePreempt tries to acquire the lock; if a live peer holds it,
// SIGTERM the peer, wait up to `grace` for it to die (polling 100ms),
// SIGKILL on timeout, then take the lock. Returns the prior holder's
// PID for logging (0 if there was none).
func (l *Lock) AcquirePreempt(grace time.Duration) (int, error) {
	priorPID := 0
	if data, err := os.ReadFile(l.Path); err == nil {
		s := strings.TrimSpace(string(data))
		if pid, perr := strconv.Atoi(s); perr == nil && isAlive(pid) {
			priorPID = pid
			proc, _ := os.FindProcess(pid)
			_ = proc.Signal(syscall.SIGTERM)
			deadline := time.Now().Add(grace)
			for time.Now().Before(deadline) {
				if !isAlive(pid) {
					break
				}
				time.Sleep(100 * time.Millisecond)
			}
			if isAlive(pid) {
				_ = proc.Signal(syscall.SIGKILL)
				time.Sleep(200 * time.Millisecond)
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(l.Path), 0o755); err != nil {
		return priorPID, err
	}
	pid := strconv.Itoa(os.Getpid())
	return priorPID, os.WriteFile(l.Path, []byte(pid+"\n"), 0o644)
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
