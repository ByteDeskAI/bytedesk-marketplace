package main

// Session-state heuristic — port of the bash `session_state()` in
// fleet/bin/claude-sessions. Reads the last ~4KB of the log and pattern-
// matches against state-indicator phrases. Order matters; first match wins.
//
// Phase 8 / B10 replaces this with periodic Haiku classification per
// session. Until then, this is the heuristic used everywhere (CLI, web,
// notify daemon).

import (
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

const stateScanBytes = 4096

var (
	stateErrorRe      = regexp.MustCompile(`(?i)error|failed|cannot|denied`)
	stateWorkingRe    = regexp.MustCompile(`(?i)waiting|running|swirling|thinking|↓\s*[0-9]+\s*tokens`)
	stateNeedsInputRe = regexp.MustCompile(`(?i)approve|allow this|permission|y/n`)
	// Done = claude printed its end-of-cook marker. Claude Code's UI
	// uses "Brewed/Sautéed/Cooked/Simmered for Nm Ns" exactly when it
	// finishes the dev loop and is awaiting next instruction; the tile
	// can be reaped at that point even if `claude` is still running.
	// Note: tmux pipe-pane captures the raw terminal byte stream which
	// interleaves ANSI escapes with text, so spaces between cells get
	// elided when the regex sees the bytes. Use `\s*` (not `\s+`) so
	// "Brewedfor4m30s" still matches.
	stateDoneRe = regexp.MustCompile(`(?i)(?:✦|\*)?\s*(?:brewed|saut[ée]ed|cooked|simmered|baked|grilled)\s*for\s*\d+m|✓|✅|merged into|pr\s*(?:merged|closed)`)
)

// stateOK is a tiny helper for the multi-stage state-detection cascade
// in session_repo.go. Lets us write `case stateOK(fn(...)):` in a
// switch without storing the result in a temporary.
func stateOK(_ string, ok bool) bool { return ok }

// sessionStateFromTmux returns "done" if `tmux has-session` for the
// given session name fails (the session is gone) OR the foreground
// pane process is no longer `claude` (claude exited; the user is back
// at their shell prompt). Returns ("", false) when the pane is still
// owned by claude — caller falls back to the log-tail heuristic to
// distinguish working / needs-input / error / etc.
//
// This is the fix for the "needs-input vs done" ambiguity: when claude
// finishes its work and exits, the resulting shell prompt looks
// identical to a permission-pause prompt to the regex heuristic, so
// every finished agent stuck in `needs-input`. The pane's foreground
// command is the unambiguous signal.
func sessionStateFromTmux(tmuxSession string) (string, bool) {
	if tmuxSession == "" {
		return "", false
	}
	if err := exec.Command("tmux", "has-session", "-t", tmuxSession).Run(); err != nil {
		return "done", true // session is gone
	}
	out, err := exec.Command("tmux", "display-message", "-p", "-t", tmuxSession, "#{pane_current_command}").Output()
	if err != nil {
		return "done", true
	}
	cmd := strings.TrimSpace(string(out))
	if cmd == "claude" || cmd == "node" {
		return "", false // claude is alive — heuristic decides
	}
	// Anything else (zsh, bash, less, etc.) means claude exited.
	return "done", true
}

// sessionStateFromLog returns the heuristic state for a session given its
// log path. "starting" if the log is missing or empty.
func sessionStateFromLog(logPath string) string {
	f, err := os.Open(logPath)
	if err != nil {
		return "starting"
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return "starting"
	}
	size := info.Size()
	bufSize := int64(stateScanBytes)
	if size < bufSize {
		bufSize = size
	}
	if _, err := f.Seek(-bufSize, io.SeekEnd); err != nil {
		return "starting"
	}
	buf := make([]byte, bufSize)
	if _, err := f.Read(buf); err != nil {
		return "starting"
	}
	tail := string(buf)
	// Order matters. Once a session prints the done-cooking marker,
	// the trailing prompt looks identical to a permission gate to the
	// needs-input regex — so check done first.
	switch {
	case stateErrorRe.MatchString(tail):
		return "error"
	case stateDoneRe.MatchString(tail):
		return "done"
	case stateWorkingRe.MatchString(tail):
		return "working"
	case stateNeedsInputRe.MatchString(tail):
		return "needs-input"
	default:
		return "idle"
	}
}

// formatRelative is a tiny helper for "2m ago" style strings. Uses fixed
// English thresholds; i18n lands when we need it.
func formatRelative(secondsAgo int64) string {
	switch {
	case secondsAgo < 60:
		return strings.Replace("Ns ago", "N", itoa(int(secondsAgo)), 1)
	case secondsAgo < 3600:
		return strings.Replace("Nm ago", "N", itoa(int(secondsAgo/60)), 1)
	case secondsAgo < 86400:
		return strings.Replace("Nh ago", "N", itoa(int(secondsAgo/3600)), 1)
	default:
		return strings.Replace("Nd ago", "N", itoa(int(secondsAgo/86400)), 1)
	}
}

func formatRuntime(secondsTotal int64) string {
	if secondsTotal < 60 {
		return "<1m"
	}
	if secondsTotal < 3600 {
		return strings.Replace("Nm", "N", itoa(int(secondsTotal/60)), 1)
	}
	hours := secondsTotal / 3600
	mins := (secondsTotal % 3600) / 60
	if mins == 0 {
		return strings.Replace("Nh", "N", itoa(int(hours)), 1)
	}
	return strings.Replace(strings.Replace("Hh Mm", "H", itoa(int(hours)), 1), "M", itoa(int(mins)), 1)
}

func itoa(n int) string {
	// Avoid pulling fmt for hot path.
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
