package main

// Spawn handler — Builder pattern for `spawn-claude-feature` CLI args.
// The client constructs a typed SpawnRequest; the server validates it,
// builds an argv (writing the prompt to a temp file so multi-line bodies
// survive), and shells out. Output is returned to the client so the
// modal can show success / surface errors.
//
//   POST /api/spawn  body: {
//     "ticket":    "BDM-99",
//     "slug":      "fix-foo",
//     "prompt":    "fix the bar",
//     "full_auto": true,
//     "parent":    "BDM-14",          // optional
//     "max_depth": 2,                  // optional
//   }
//
// On success → 200 + {ok:true, ticket, stdout}. On invalid args → 400.
// On spawn failure (CLI returns non-zero) → 502 + stderr surfaced.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
)

type SpawnRequest struct {
	Ticket   string `json:"ticket"`
	Slug     string `json:"slug"`
	Prompt   string `json:"prompt"`
	FullAuto bool   `json:"full_auto"`
	Parent   string `json:"parent,omitempty"`
	MaxDepth int    `json:"max_depth,omitempty"`
}

var ticketPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]+-\d+$`)
var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

func (r SpawnRequest) validate() error {
	if !ticketPattern.MatchString(r.Ticket) {
		return errors.New("ticket must look like BDM-99")
	}
	if !slugPattern.MatchString(r.Slug) {
		return errors.New("slug must be lowercase letters/digits/hyphens (1-64 chars, start with [a-z0-9])")
	}
	if strings.TrimSpace(r.Prompt) == "" {
		return errors.New("prompt is required")
	}
	if r.MaxDepth < 0 || r.MaxDepth > 5 {
		return errors.New("max_depth must be 0..5")
	}
	if r.Parent != "" && !ticketPattern.MatchString(r.Parent) {
		return errors.New("parent must look like BDM-99")
	}
	return nil
}

func (r SpawnRequest) buildArgs(promptPath string) []string {
	args := []string{r.Ticket, r.Slug, "--prompt-file", promptPath}
	if r.FullAuto {
		args = append(args, "--full-auto")
	}
	if r.Parent != "" {
		args = append(args, "--parent", r.Parent)
	}
	if r.MaxDepth > 0 {
		args = append(args, "--max-depth", fmt.Sprintf("%d", r.MaxDepth))
	}
	return args
}

func spawnBin() string {
	if v, err := exec.LookPath("spawn-claude-feature"); err == nil {
		return v
	}
	return "spawn-claude-feature"
}

func handleSpawn(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var req SpawnRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
		return
	}
	if err := req.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	f, err := os.CreateTemp("", "fleet-spawn-prompt-*.txt")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("temp prompt: %w", err))
		return
	}
	promptPath := f.Name()
	defer os.Remove(promptPath)
	if _, err := f.WriteString(req.Prompt); err != nil {
		f.Close()
		writeError(w, http.StatusInternalServerError, fmt.Errorf("write prompt: %w", err))
		return
	}
	f.Close()

	cmd := exec.Command(spawnBin(), req.buildArgs(promptPath)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("spawn failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"ticket": req.Ticket,
		"slug":   req.Slug,
		"stdout": strings.TrimSpace(string(out)),
	})
}

// handleSessionReview wraps the /fleet:review skill by spawning a
// reviewer feature pinned to the parent ticket. Reviewer slug defaults
// to "review-of-<TICKET>" lowercased.
//
//	POST /api/sessions/<TICKET>/review  body: {"prompt": "...", "full_auto": true}
func handleSessionReview(w http.ResponseWriter, r *http.Request, parentTicket string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var body struct {
		Prompt   string `json:"prompt"`
		FullAuto bool   `json:"full_auto"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
		return
	}
	if !ticketPattern.MatchString(parentTicket) {
		writeError(w, http.StatusBadRequest, errors.New("parent ticket must look like BDM-99"))
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		prompt = fmt.Sprintf("Review the work in %s. Read its branch / diff / open PR, then post a structured review.", parentTicket)
	}
	// Reviewer ticket "<PARENT>-rev" deliberately does NOT match our
	// validation regex (it has a trailing "-rev"); build args by hand
	// instead of routing through SpawnRequest.validate.
	revTicket := parentTicket + "-rev"
	revSlug := "review-of-" + strings.ToLower(parentTicket)

	f, err := os.CreateTemp("", "fleet-review-prompt-*.txt")
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Errorf("temp prompt: %w", err))
		return
	}
	promptPath := f.Name()
	defer os.Remove(promptPath)
	if _, err := f.WriteString(prompt); err != nil {
		f.Close()
		writeError(w, http.StatusInternalServerError, fmt.Errorf("write prompt: %w", err))
		return
	}
	f.Close()

	args := []string{revTicket, revSlug, "--prompt-file", promptPath, "--parent", parentTicket}
	if body.FullAuto {
		args = append(args, "--full-auto")
	}
	cmd := exec.Command(spawnBin(), args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("review spawn failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"ticket": revTicket,
		"stdout": strings.TrimSpace(string(out)),
	})
}
