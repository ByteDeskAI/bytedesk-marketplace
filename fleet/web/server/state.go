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
	"regexp"
	"strings"
)

const stateScanBytes = 4096

var (
	stateErrorRe      = regexp.MustCompile(`(?i)error|failed|cannot|denied`)
	stateWorkingRe    = regexp.MustCompile(`(?i)waiting|running|swirling|thinking|↓\s*[0-9]+\s*tokens`)
	stateNeedsInputRe = regexp.MustCompile(`(?i)approve|allow this|permission|y/n`)
	stateDoneRe       = regexp.MustCompile(`(?i)✓|✅|complete|done|merged`)
)

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
	switch {
	case stateErrorRe.MatchString(tail):
		return "error"
	case stateWorkingRe.MatchString(tail):
		return "working"
	case stateNeedsInputRe.MatchString(tail):
		return "needs-input"
	case stateDoneRe.MatchString(tail):
		return "done"
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
