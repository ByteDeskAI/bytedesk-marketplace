package main

// Storage diagnostics — surfaces the exact filesystem paths the
// dashboard uses so the user can verify that settings, sessions, and
// stats really do live in a persistent location across plugin
// upgrades (BDM-47).

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
)

type storageInfo struct {
	ProjectKey     string           `json:"project_key"`
	CanonicalDir   string           `json:"canonical_dir"`
	DataRoot       string           `json:"data_root"`
	ProjectDir     string           `json:"project_dir"`
	WebDir         string           `json:"web_dir"`
	SettingsPath   string           `json:"settings_path"`
	SessionsDir    string           `json:"sessions_dir"`
	ChainsDir      string           `json:"chains_dir"`
	RulesDir       string           `json:"rules_dir"`
	Exists         map[string]bool  `json:"exists"`
	SizesBytes     map[string]int64 `json:"sizes_bytes"`
	PersistentNote string           `json:"persistent_note"`
}

func handleStorageInfo(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET"))
		return
	}
	canonical, _ := canonicalDir()
	projDir, _ := projectDir()
	webPath, _ := webDir()
	settings := filepath.Join(webPath, "settings.toml")
	sessions := filepath.Join(projDir, "sessions")
	chains := filepath.Join(projDir, "chains")
	rules := filepath.Join(projDir, "rules")

	exists := map[string]bool{
		"data_root":     dirExists(dataRoot()),
		"project_dir":   dirExists(projDir),
		"web_dir":       dirExists(webPath),
		"settings_path": fileExists(settings),
		"sessions_dir":  dirExists(sessions),
		"chains_dir":    dirExists(chains),
		"rules_dir":     dirExists(rules),
	}
	sizes := map[string]int64{
		"settings_path": fileSize(settings),
		"sessions_dir":  dirSize(sessions),
		"chains_dir":    dirSize(chains),
		"rules_dir":     dirSize(rules),
	}

	info := storageInfo{
		ProjectKey:     deps.projectKey,
		CanonicalDir:   canonical,
		DataRoot:       dataRoot(),
		ProjectDir:     projDir,
		WebDir:         webPath,
		SettingsPath:   settings,
		SessionsDir:    sessions,
		ChainsDir:      chains,
		RulesDir:       rules,
		Exists:         exists,
		SizesBytes:     sizes,
		PersistentNote: "These paths live OUTSIDE the plugin install dir (cache/) — they survive `/plugin update`. If the dashboard ever lands on a different project_key, settings won't follow.",
	}
	writeJSON(w, http.StatusOK, info)
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}

func fileSize(p string) int64 {
	info, err := os.Stat(p)
	if err != nil {
		return 0
	}
	return info.Size()
}

func dirSize(p string) int64 {
	var total int64
	_ = filepath.Walk(p, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info == nil {
			return nil
		}
		if !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}
