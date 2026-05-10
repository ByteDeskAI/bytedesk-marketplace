package main

// transcript.go — derive session state from the structured Claude Code
// transcript jsonl instead of regex over the rendered tmux log.
//
// Each Claude Code conversation writes a .jsonl with one event per
// line at:
//   ~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl
// where <sanitized-cwd> is the cwd path with "/" replaced by "-" and
// a leading "-".
//
// We read the LAST few entries and infer state from typed fields
// (`type`, `message.stop_reason`, timestamp) instead of regex over
// rendered terminal bytes. That's far more robust than parsing
// `Brewedfor4m30s` out of the log tail.

import (
	"bufio"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// sanitizeProjectDir mirrors Claude Code's cwd → project-dir mapping.
// Both `/` and `.` get replaced with `-`, e.g.
//
//	/home/u/repo/.claude/worktrees/X-slug
//	   → -home-u-repo--claude-worktrees-X-slug
//
// This MUST match what claude itself produces under
// `~/.claude/projects/`. The `.`-replacement step is the one that
// trips up naive `filepath.Separator`-only sanitizers (worktrees
// nested under a `.claude/` dir lose their transcripts otherwise).
func sanitizeProjectDir(abs string) string {
	r := strings.NewReplacer(string(filepath.Separator), "-", ".", "-")
	return r.Replace(abs)
}

// idlePauseThreshold — if the last assistant turn ended `end_turn`
// more than this ago, the agent is "done" (idle waiting). Below
// this we treat it as `needs-input` (just paused, may resume).
const idlePauseThreshold = 30 * time.Second

// workingThreshold — tool-use bursts within this window mean the agent
// is actively working.
const workingThreshold = 8 * time.Second

type transcriptEntry struct {
	Type      string    `json:"type"`
	Timestamp time.Time `json:"timestamp"`
	Message   struct {
		Role       string `json:"role"`
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type    string `json:"type"`
			Name    string `json:"name"` // tool name on tool_use
			IsError bool   `json:"is_error"`
			Text    string `json:"text"`
		} `json:"content"`
	} `json:"message"`
}

// findTranscript locates the most-recently-modified .jsonl for a
// worktree path. Returns "" if none exists yet (session just started,
// claude hasn't written its first message).
func findTranscript(worktreePath string) string {
	if worktreePath == "" {
		return ""
	}
	abs, err := filepath.Abs(worktreePath)
	if err != nil {
		return ""
	}
	dir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", sanitizeProjectDir(abs))
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var newestPath string
	var newestMtime time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(newestMtime) {
			newestMtime = info.ModTime()
			newestPath = filepath.Join(dir, e.Name())
		}
	}
	return newestPath
}

// sessionStateFromTranscript derives state from the last few entries
// of the jsonl transcript. Returns ("", false) if the transcript
// can't be found or parsed (caller falls back to log regex).
func sessionStateFromTranscript(worktreePath string) (string, bool) {
	path := findTranscript(worktreePath)
	if path == "" {
		return "", false
	}
	entries, err := readTranscriptTail(path, 50)
	if err != nil || len(entries) == 0 {
		return "", false
	}

	now := time.Now()
	// Walk backward looking for the most-recent assistant turn or
	// tool result.
	var lastAssistant *transcriptEntry
	var lastToolResult *transcriptEntry
	var sawError bool
	for i := len(entries) - 1; i >= 0; i-- {
		e := &entries[i]
		switch e.Type {
		case "assistant":
			if lastAssistant == nil {
				lastAssistant = e
			}
		case "user":
			// User entries can carry tool_result content. Mark errors.
			for _, c := range e.Message.Content {
				if c.Type == "tool_result" {
					if lastToolResult == nil {
						lastToolResult = e
					}
					if c.IsError {
						sawError = true
					}
				}
			}
		}
		// Once we have both, stop walking.
		if lastAssistant != nil && lastToolResult != nil {
			break
		}
	}

	// If a recent tool error landed inside the working window — and
	// the agent hasn't subsequently posted another turn — surface it.
	// Without the assistant-after-error guard, ANY tool error within
	// the walked tail would lock the session into "error" forever
	// even after a clean end_turn (BDM-32 follow-up).
	if sawError && lastToolResult != nil && now.Sub(lastToolResult.Timestamp) < idlePauseThreshold {
		if lastAssistant == nil || lastAssistant.Timestamp.Before(lastToolResult.Timestamp) {
			return "error", true
		}
	}

	if lastAssistant == nil {
		return "", false // brand-new session, no assistant turn yet
	}

	age := now.Sub(lastAssistant.Timestamp)

	switch lastAssistant.Message.StopReason {
	case "tool_use":
		// claude mid-tool-loop. If the last assistant entry is recent,
		// it's actively working; if older, the loop stalled.
		if age < workingThreshold {
			return "working", true
		}
		// stalled mid-loop — fall through to log-regex heuristic so
		// we don't mislabel a hung agent as `done`.
		return "", false
	case "end_turn":
		// claude paused. Below threshold → `needs-input` (may resume);
		// above → `done` (idle indefinitely).
		if age < idlePauseThreshold {
			return "needs-input", true
		}
		return "done", true
	case "max_tokens":
		return "error", true
	}
	return "", false
}

func readTranscriptTail(path string, maxEntries int) ([]transcriptEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// Cheap approach: scan from start; for typical fleet sessions the
	// transcripts are < 10 MB so this is microseconds. If transcripts
	// grow much bigger we can switch to a reverse byte scan.
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var all []transcriptEntry
	for sc.Scan() {
		var e transcriptEntry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue // skip unparseable lines
		}
		all = append(all, e)
	}
	if err := sc.Err(); err != nil && !errors.Is(err, bufio.ErrTooLong) {
		return all, err
	}
	if len(all) > maxEntries {
		all = all[len(all)-maxEntries:]
	}
	return all, nil
}

// SubAgentFile — discovered sub-agent transcript on disk. Each one
// corresponds to a single Task-tool invocation by the parent claude.
type SubAgentFile struct {
	AgentID string // basename minus "agent-" prefix and ".jsonl" suffix
	Path    string
	Mtime   time.Time
}

// findSubAgentTranscripts globs `<projectDir>/subagents/agent-*.jsonl`
// for the worktree's project dir. Sub-agents share the parent's tmux
// pane but get their own jsonl with `isSidechain: true`. Returns nil
// when the subagents directory doesn't exist (no sub-agents have run
// yet for this conversation).
func findSubAgentTranscripts(worktreePath string) []SubAgentFile {
	if worktreePath == "" {
		return nil
	}
	abs, err := filepath.Abs(worktreePath)
	if err != nil {
		return nil
	}
	subDir := filepath.Join(os.Getenv("HOME"), ".claude", "projects", sanitizeProjectDir(abs), "subagents")
	entries, err := os.ReadDir(subDir)
	if err != nil {
		return nil
	}
	out := make([]SubAgentFile, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, "agent-") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		id := strings.TrimSuffix(strings.TrimPrefix(name, "agent-"), ".jsonl")
		out = append(out, SubAgentFile{
			AgentID: id,
			Path:    filepath.Join(subDir, name),
			Mtime:   info.ModTime(),
		})
	}
	return out
}
