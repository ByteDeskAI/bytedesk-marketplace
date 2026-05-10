package main

// ProjectsRepo — enumerate every project key under ${CLAUDE_PLUGIN_DATA}/
// projects/. The server discovers peers by scanning that dir and reading
// their `web/config.toml` for the bound port (so the sidebar can link to
// each project's own dashboard at its own URL — see BDM-15 plan, "Multi-
// project navigation").

import (
	"bufio"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// readProjectLabel returns the canonical worktree path for a project.
// First tries the explicit web/worktree file (written at server start),
// then falls back to scanning any session meta file for `worktree=`.
func readProjectLabel(projDir string) string {
	if data, err := os.ReadFile(filepath.Join(projDir, "web", "worktree")); err == nil {
		return strings.TrimSpace(string(data))
	}
	sessions, err := os.ReadDir(filepath.Join(projDir, "sessions"))
	if err != nil {
		return ""
	}
	for _, s := range sessions {
		if !s.IsDir() {
			continue
		}
		f, err := os.Open(filepath.Join(projDir, "sessions", s.Name(), "meta"))
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "worktree=") {
				val := strings.TrimPrefix(line, "worktree=")
				f.Close()
				// Strip any /.claude/worktrees/<TICKET> suffix to get the repo root.
				if idx := strings.Index(val, "/.claude/worktrees/"); idx > 0 {
					val = val[:idx]
				}
				return val
			}
		}
		f.Close()
	}
	return ""
}

type ProjectsRepo struct {
	dataRootDir string // ${CLAUDE_PLUGIN_DATA}
}

func NewProjectsRepo(dataRootDir string) *ProjectsRepo {
	return &ProjectsRepo{dataRootDir: dataRootDir}
}

// List returns all project keys with their bound ports (if known) and
// constructed URLs. Projects that exist but haven't started a web server
// (no config.toml) are still included with port=0 so the sidebar can
// indicate their state.
func (r *ProjectsRepo) List() ([]Project, error) {
	root := filepath.Join(r.dataRootDir, "projects")
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []Project{}, nil
		}
		return nil, err
	}
	out := make([]Project, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		key := e.Name()
		projDir := filepath.Join(root, key)
		webPath := filepath.Join(projDir, "web")
		cfgPath := filepath.Join(webPath, "config.toml")

		p := Project{Key: key, Path: projDir}
		if data, err := os.ReadFile(cfgPath); err == nil {
			cfg := &WebConfig{Bind: "127.0.0.1"}
			parseTOML(string(data), cfg)
			p.Port = cfg.Port
			if cfg.Port > 0 {
				p.URL = fmt.Sprintf("http://%s:%d/", cfg.Bind, cfg.Port)
			}
		}
		// Worktree label — written by the dashboard server on startup
		// (web/worktree file). Falls back to a session meta's `worktree=`
		// line if the file is missing.
		if path := readProjectLabel(projDir); path != "" {
			p.Label = filepath.Base(path)
		}
		out = append(out, p)
	}
	return out, nil
}
