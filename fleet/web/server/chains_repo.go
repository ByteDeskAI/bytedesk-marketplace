package main

// ChainsRepo — Phase 12.4 (BDM-28). Persists user-authored chain
// definitions (DAGs of Spawn / Wait / Judge / Condition / Notify /
// Script nodes) as JSON files, one per chain.
//
// Storage:
//   ${CLAUDE_PLUGIN_DATA}/projects/<KEY>/chains/<id>.json
//
// Repository pattern (mirrors SettingsRepo): the type owns the
// directory layout; route handlers consume typed Chain values.
//
// Schema is intentionally simple + forward-compatible — extra fields
// in the JSON are ignored on load, and node.config is an open-ended
// map so new node types can land without a migration.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Chain is a persisted DAG. Trusted is set true when a depth-0 user
// runs the chain via the dashboard (vs. spawned by another agent), and
// gates the Script node's bash exec.
type Chain struct {
	ID      string      `json:"id"`
	Name    string      `json:"name"`
	Created time.Time   `json:"created"`
	Updated time.Time   `json:"updated"`
	Nodes   []ChainNode `json:"nodes"`
	Edges   []ChainEdge `json:"edges"`
	Trusted bool        `json:"trusted,omitempty"`
}

type ChainNode struct {
	ID     string                 `json:"id"`
	Type   string                 `json:"type"` // spawn|wait|judge|condition|notify|script
	X      int                    `json:"x"`
	Y      int                    `json:"y"`
	Config map[string]interface{} `json:"config"`
}

type ChainEdge struct {
	From      string `json:"from"`
	To        string `json:"to"`
	OnSuccess bool   `json:"on_success,omitempty"`
	OnFailure bool   `json:"on_failure,omitempty"`
}

type ChainsRepo struct {
	dir string
	mu  sync.Mutex
}

func NewChainsRepo(projectDir string) *ChainsRepo {
	return &ChainsRepo{dir: filepath.Join(projectDir, "chains")}
}

// Dir returns the on-disk root for chains. Useful for the runner which
// also writes run-state files alongside the chain JSON.
func (r *ChainsRepo) Dir() string { return r.dir }

func (r *ChainsRepo) ensureDir() error {
	return os.MkdirAll(r.dir, 0o755)
}

// List returns all chain JSON files in the project. Empty slice (no
// error) if the dir doesn't yet exist.
func (r *ChainsRepo) List() ([]Chain, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entries, err := os.ReadDir(r.dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []Chain{}, nil
		}
		return nil, err
	}
	out := make([]Chain, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		c, err := r.readFile(filepath.Join(r.dir, name))
		if err != nil {
			continue // skip unreadable files; don't fail the list
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Updated.After(out[j].Updated)
	})
	return out, nil
}

// Get returns one chain by id. Wraps fs.ErrNotExist when missing.
func (r *ChainsRepo) Get(id string) (Chain, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !validChainID(id) {
		return Chain{}, fmt.Errorf("invalid chain id %q", id)
	}
	return r.readFile(filepath.Join(r.dir, id+".json"))
}

func (r *ChainsRepo) readFile(path string) (Chain, error) {
	var c Chain
	data, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("parse %s: %w", path, err)
	}
	return c, nil
}

// Save writes the chain. Auto-fills timestamps; validates id.
func (r *ChainsRepo) Save(c Chain) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !validChainID(c.ID) {
		return fmt.Errorf("invalid chain id %q", c.ID)
	}
	if err := r.ensureDir(); err != nil {
		return err
	}
	now := time.Now().UTC()
	if c.Created.IsZero() {
		c.Created = now
	}
	c.Updated = now
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	tmp := filepath.Join(r.dir, c.ID+".json.tmp")
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(r.dir, c.ID+".json"))
}

// Delete removes the chain JSON. Best-effort cleanup of run state.
func (r *ChainsRepo) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !validChainID(id) {
		return fmt.Errorf("invalid chain id %q", id)
	}
	path := filepath.Join(r.dir, id+".json")
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	// Remove sibling runs dir if present; ignore errors.
	_ = os.RemoveAll(filepath.Join(r.dir, id+".runs"))
	return nil
}

// validChainID restricts ids to a slug-ish shape so users can't write
// to arbitrary paths via the id field. Accepts a-z 0-9 - _ and dot,
// 1..96 chars, doesn't start with a dot.
func validChainID(id string) bool {
	if id == "" || len(id) > 96 || strings.HasPrefix(id, ".") {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.':
		default:
			return false
		}
	}
	return true
}
