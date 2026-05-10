package main

// Phase 12.2 (BDM-28). Adapter wrappers around git + gh CLIs to expose
// per-session worktree status (A22) and PR state (A21) as /api endpoints.
//
//   GET /api/sessions/<TICKET>/git
//   GET /api/sessions/<TICKET>/pr
//
// Both shell out to the user-installed CLIs (git already required; gh
// is optional — endpoint reports the absence). The handlers fan out
// concurrent subprocesses, collate, and return JSON.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

type gitStatus struct {
	Worktree string     `json:"worktree"`
	Branch   string     `json:"branch"`
	Clean    bool       `json:"clean"`
	Files    []gitFile  `json:"files"`
	Log      []gitEntry `json:"log"`
}

type gitFile struct {
	Status string `json:"status"` // " M", "??", "A " etc — porcelain v1 codes
	Path   string `json:"path"`
}

type gitEntry struct {
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	When    string `json:"when"`
}

func handleSessionGit(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
		return
	}
	if s.Worktree == "" {
		writeError(w, http.StatusNotFound, errors.New("session has no worktree path"))
		return
	}

	st := gitStatus{Worktree: s.Worktree, Branch: s.Branch}

	// porcelain status
	out, _ := exec.Command("git", "-C", s.Worktree, "status", "--porcelain=v1").Output()
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 4 {
			continue
		}
		st.Files = append(st.Files, gitFile{Status: line[:2], Path: strings.TrimSpace(line[3:])})
	}
	st.Clean = len(st.Files) == 0

	// last 5 commits
	logOut, _ := exec.Command("git", "-C", s.Worktree, "log", "-5",
		"--pretty=format:%h%x09%s%x09%an%x09%ar").Output()
	for _, line := range strings.Split(strings.TrimRight(string(logOut), "\n"), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) != 4 {
			continue
		}
		st.Log = append(st.Log, gitEntry{Hash: parts[0], Subject: parts[1], Author: parts[2], When: parts[3]})
	}

	writeJSON(w, http.StatusOK, st)
}

type prStatus struct {
	Available bool                   `json:"available"` // false if `gh` not installed
	Number    int                    `json:"number,omitempty"`
	State     string                 `json:"state,omitempty"` // OPEN/MERGED/CLOSED
	URL       string                 `json:"url,omitempty"`
	Title     string                 `json:"title,omitempty"`
	Author    string                 `json:"author,omitempty"`
	Checks    []map[string]any       `json:"checks,omitempty"`
	Files     []string               `json:"files,omitempty"`
	Raw       map[string]any         `json:"raw,omitempty"`
	Error     string                 `json:"error,omitempty"`
}

func handleSessionPR(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
		return
	}
	if _, err := exec.LookPath("gh"); err != nil {
		writeJSON(w, http.StatusOK, prStatus{Available: false, Error: "gh CLI not on PATH"})
		return
	}
	if s.Worktree == "" {
		writeJSON(w, http.StatusOK, prStatus{Available: false, Error: "session has no worktree"})
		return
	}

	st := prStatus{Available: true}

	// `gh pr view` runs against the current dir; set Dir to the worktree.
	cmd := exec.Command("gh", "pr", "view",
		"--json", "number,state,url,title,author,files")
	cmd.Dir = s.Worktree
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Common case: "no pull requests found" — return success with no PR.
		if strings.Contains(strings.ToLower(string(out)), "no pull request") ||
			strings.Contains(strings.ToLower(string(out)), "no commits between") {
			writeJSON(w, http.StatusOK, prStatus{Available: true, Error: "no PR for this branch"})
			return
		}
		writeJSON(w, http.StatusOK, prStatus{Available: true, Error: strings.TrimSpace(string(out))})
		return
	}

	var raw map[string]any
	if err := json.Unmarshal(out, &raw); err == nil {
		st.Raw = raw
		if n, ok := raw["number"].(float64); ok {
			st.Number = int(n)
		}
		if v, ok := raw["state"].(string); ok {
			st.State = v
		}
		if v, ok := raw["url"].(string); ok {
			st.URL = v
		}
		if v, ok := raw["title"].(string); ok {
			st.Title = v
		}
		if a, ok := raw["author"].(map[string]any); ok {
			if v, ok := a["login"].(string); ok {
				st.Author = v
			}
		}
		if files, ok := raw["files"].([]any); ok {
			for _, f := range files {
				if fm, ok := f.(map[string]any); ok {
					if path, ok := fm["path"].(string); ok {
						st.Files = append(st.Files, path)
					}
				}
			}
		}
	}

	// Checks (best-effort).
	if st.Number > 0 {
		ccmd := exec.Command("gh", "pr", "checks", fmt.Sprintf("%d", st.Number), "--json", "name,state,conclusion,workflow")
		ccmd.Dir = s.Worktree
		if cout, cerr := ccmd.Output(); cerr == nil {
			var checks []map[string]any
			_ = json.Unmarshal(cout, &checks)
			st.Checks = checks
		}
	}

	writeJSON(w, http.StatusOK, st)
}
