package main

// Settings — Phase 10 (BDM-26). Persistable per-project settings beyond
// the [web] block in config.toml. Today's blocks:
//
//   [mobile]    — B15 mobile push (ntfy URL + topic + which kinds to send)
//   [tailscale] — B17 share toggle + suggested command snippet
//   [theme]     — C7 placeholder (Phase 11 fills it in)
//
// Stored at ${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/settings.toml.
// Repository pattern: SettingsRepo owns the file; routes never touch it
// directly.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Settings struct {
	Mobile    MobileConfig    `json:"mobile"`
	Tailscale TailscaleConfig `json:"tailscale"`
	Theme     ThemeConfig     `json:"theme"`
	AI        AIConfig        `json:"ai"`
}

type MobileConfig struct {
	Enabled bool   `json:"enabled"`
	NtfyURL string `json:"ntfy_url"` // e.g. https://ntfy.sh
	Topic   string `json:"topic"`    // e.g. fleet-alerts-abc123
	Kinds   string `json:"kinds"`    // comma list: "merge,pr_opened,review_summary"
}

type TailscaleConfig struct {
	Enabled bool `json:"enabled"`
	Funnel  bool `json:"funnel"` // tailscale serve vs. tailscale funnel
}

type ThemeConfig struct {
	Theme  string `json:"theme"`  // light | dark | repllt-blue
	Accent string `json:"accent"` // hex
	Font   string `json:"font"`   // inter | jetbrains-mono | system
}

// AIConfig — Phase 12.9 (B10/B11/B12). Controls the Haiku sidecar that
// powers the JudgeProvider. The actual API key is NEVER stored in
// settings.toml; we only record which environment variable to read. By
// default that's ANTHROPIC_API_KEY (which is also what the sidecar reads
// directly).
type AIConfig struct {
	Enabled bool   `json:"enabled"` // explicit on/off; if true and KeyEnv unset, server still requires ANTHROPIC_API_KEY
	Model   string `json:"model"`   // e.g. "claude-haiku-4-5-20251001"
	KeyEnv  string `json:"key_env"` // env var name that holds the API key
}

type SettingsRepo struct {
	path string
	mu   sync.Mutex
}

func NewSettingsRepo(webPath string) *SettingsRepo {
	return &SettingsRepo{path: filepath.Join(webPath, "settings.toml")}
}

func (r *SettingsRepo) Load() (Settings, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := defaultSettings()
	data, err := os.ReadFile(r.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s, nil
		}
		return s, err
	}
	parseSettingsTOML(string(data), &s)
	return s, nil
}

func (r *SettingsRepo) Save(s Settings) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(r.path, []byte(formatSettingsTOML(s)), 0o644)
}

func defaultSettings() Settings {
	return Settings{
		Mobile:    MobileConfig{NtfyURL: "https://ntfy.sh", Kinds: "merge,pr_opened,review_summary"},
		Tailscale: TailscaleConfig{},
		Theme:     ThemeConfig{Theme: "light", Accent: "#2563eb", Font: "inter"},
		AI:        AIConfig{Enabled: false, Model: "claude-haiku-4-5-20251001", KeyEnv: "ANTHROPIC_API_KEY"},
	}
}

func formatSettingsTOML(s Settings) string {
	var sb strings.Builder
	sb.WriteString("[mobile]\n")
	sb.WriteString(fmt.Sprintf("enabled = %t\n", s.Mobile.Enabled))
	sb.WriteString(fmt.Sprintf("ntfy_url = %q\n", s.Mobile.NtfyURL))
	sb.WriteString(fmt.Sprintf("topic = %q\n", s.Mobile.Topic))
	sb.WriteString(fmt.Sprintf("kinds = %q\n", s.Mobile.Kinds))
	sb.WriteString("\n[tailscale]\n")
	sb.WriteString(fmt.Sprintf("enabled = %t\n", s.Tailscale.Enabled))
	sb.WriteString(fmt.Sprintf("funnel = %t\n", s.Tailscale.Funnel))
	sb.WriteString("\n[theme]\n")
	sb.WriteString(fmt.Sprintf("theme = %q\n", s.Theme.Theme))
	sb.WriteString(fmt.Sprintf("accent = %q\n", s.Theme.Accent))
	sb.WriteString(fmt.Sprintf("font = %q\n", s.Theme.Font))
	sb.WriteString("\n[ai]\n")
	sb.WriteString(fmt.Sprintf("enabled = %t\n", s.AI.Enabled))
	sb.WriteString(fmt.Sprintf("model = %q\n", s.AI.Model))
	sb.WriteString(fmt.Sprintf("key_env = %q\n", s.AI.KeyEnv))
	return sb.String()
}

func parseSettingsTOML(s string, out *Settings) {
	section := ""
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = line[1 : len(line)-1]
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.Trim(strings.TrimSpace(line[eq+1:]), `"`)
		switch section {
		case "mobile":
			switch key {
			case "enabled":
				out.Mobile.Enabled = val == "true"
			case "ntfy_url":
				out.Mobile.NtfyURL = val
			case "topic":
				out.Mobile.Topic = val
			case "kinds":
				out.Mobile.Kinds = val
			}
		case "tailscale":
			switch key {
			case "enabled":
				out.Tailscale.Enabled = val == "true"
			case "funnel":
				out.Tailscale.Funnel = val == "true"
			}
		case "theme":
			switch key {
			case "theme":
				out.Theme.Theme = val
			case "accent":
				out.Theme.Accent = val
			case "font":
				out.Theme.Font = val
			}
		case "ai":
			switch key {
			case "enabled":
				out.AI.Enabled = val == "true"
			case "model":
				out.AI.Model = val
			case "key_env":
				out.AI.KeyEnv = val
			}
		}
	}
}

func handleSettings(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	switch r.Method {
	case http.MethodGet:
		s, err := deps.settings.Load()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, s)
	case http.MethodPut:
		var s Settings
		if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
			return
		}
		if err := deps.settings.Save(s); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, s)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET or PUT"))
	}
}
