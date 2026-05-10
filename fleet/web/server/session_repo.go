package main

// SessionRepo — reads per-session state from disk. Glob the project's
// sessions/ dir, parse each meta file, derive state from the log tail.
//
// Repository pattern (per the BDM-14 plan): one type owns the directory
// layout; route handlers ask for typed Sessions and don't touch paths.

import (
	"bufio"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type SessionRepo struct {
	projectDir string // ${CLAUDE_PLUGIN_DATA}/projects/<KEY>
}

func NewSessionRepo(projectDir string) *SessionRepo {
	return &SessionRepo{projectDir: projectDir}
}

// List scans sessions/*/meta and returns one Session per ticket.
// Returns an empty slice (no error) if the sessions dir doesn't exist.
func (r *SessionRepo) List() ([]Session, error) {
	root := filepath.Join(r.projectDir, "sessions")
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []Session{}, nil
		}
		return nil, err
	}
	out := make([]Session, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		s, err := r.read(e.Name())
		if err != nil {
			continue // skip broken meta; don't fail the whole list
		}
		out = append(out, s)
	}
	return out, nil
}

// Get returns one session by ticket. Wraps fs.ErrNotExist when missing.
func (r *SessionRepo) Get(ticket string) (Session, error) {
	return r.read(ticket)
}

func (r *SessionRepo) read(ticket string) (Session, error) {
	dir := filepath.Join(r.projectDir, "sessions", ticket)
	meta := filepath.Join(dir, "meta")
	f, err := os.Open(meta)
	if err != nil {
		return Session{}, err
	}
	defer f.Close()

	s := Session{Ticket: ticket}
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		line := scan.Text()
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		k := line[:eq]
		v := line[eq+1:]
		switch k {
		case "ticket":
			// already set from dir name; only override if file disagrees
			if v != "" {
				s.Ticket = v
			}
		case "slug":
			s.Slug = v
		case "session":
			s.TmuxSession = v
		case "worktree":
			s.Worktree = v
		case "branch":
			s.Branch = v
		case "log":
			s.LogPath = v
		case "results":
			s.ResultsPath = v
		case "started":
			if t, err := time.Parse(time.RFC3339, v); err == nil {
				s.Started = t
			}
		case "full_auto":
			s.FullAuto = v == "1" || strings.EqualFold(v, "true")
		case "parent":
			s.Parent = v
		case "depth":
			if n, err := strconv.Atoi(v); err == nil {
				s.Depth = n
			}
		case "max_cost_usd":
			if n, err := strconv.ParseFloat(v, 64); err == nil {
				s.MaxCostUSD = n
			}
		case "max_runtime_min":
			if n, err := strconv.Atoi(v); err == nil {
				s.MaxRuntimeMin = n
			}
		case "prompt_file":
			s.PromptFile = v
		}
	}
	// If log path missing or relative-to-old-layout, fall back to
	// canonical Phase-1+ location: <session_dir>/log.
	if s.LogPath == "" {
		s.LogPath = filepath.Join(dir, "log")
	}
	// State-detection cascade (highest-fidelity first):
	//   1. tmux pane probe — definitive "claude exited" signal
	//   2. transcript jsonl — typed end_turn / tool_use / pr-link from
	//      claude's own structured event stream
	//   3. log-tail regex — fallback when transcript is missing
	//      (brand-new session) or doesn't carry a stop_reason
	switch {
	case stateOK(sessionStateFromTmux(s.TmuxSession)):
		s.State, _ = sessionStateFromTmux(s.TmuxSession)
	case stateOK(sessionStateFromTranscript(s.Worktree)):
		s.State, _ = sessionStateFromTranscript(s.Worktree)
	default:
		s.State = sessionStateFromLog(s.LogPath)
	}
	if info, err := os.Stat(s.LogPath); err == nil {
		s.LastActivity = info.ModTime()
	} else {
		s.LastActivity = s.Started
	}
	s.Tokens = latestTokens(s.LogPath)
	s.CostUSD = roughCostUSD(s.Tokens)
	return s, nil
}

var tokenLineRe = regexp.MustCompile(`([0-9][0-9,]*(?:\.[0-9]+)?)([kKmM])?\s*tokens`)

// latestTokens scans the last ~8KB of the log for `↓ 87.2k tokens` or
// `87,200 tokens` style markers and returns the last match. 0 if none.
// Mirrors the bash `latest_tokens()` helper.
func latestTokens(logPath string) int {
	f, err := os.Open(logPath)
	if err != nil {
		return 0
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() == 0 {
		return 0
	}
	bufSize := int64(8192)
	if info.Size() < bufSize {
		bufSize = info.Size()
	}
	if _, err := f.Seek(-bufSize, 2 /* io.SeekEnd */); err != nil {
		return 0
	}
	buf := make([]byte, bufSize)
	if _, err := f.Read(buf); err != nil {
		return 0
	}
	matches := tokenLineRe.FindAllStringSubmatch(string(buf), -1)
	if len(matches) == 0 {
		return 0
	}
	last := matches[len(matches)-1]
	raw := strings.ReplaceAll(last[1], ",", "")
	n, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0
	}
	switch strings.ToLower(last[2]) {
	case "k":
		n *= 1000
	case "m":
		n *= 1_000_000
	}
	return int(n)
}

// roughCostUSD applies a flat $5 per million tokens — close enough for
// the dashboard's "rough cost" surface. Real per-message pricing requires
// the API tier (input/output split + model variant), which Phase 4+ can
// pull from the log's structured metadata if/when claude-sessions emits it.
func roughCostUSD(tokens int) float64 {
	return float64(tokens) * 5.0 / 1_000_000.0
}
