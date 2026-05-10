package main

// ProjectsRepo — enumerate every project key under ${CLAUDE_PLUGIN_DATA}/
// projects/. The server discovers peers by scanning that dir and reading
// their `web/config.toml` for the bound port (so the sidebar can link to
// each project's own dashboard at its own URL — see BDM-15 plan, "Multi-
// project navigation").

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

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
		out = append(out, p)
	}
	return out, nil
}
