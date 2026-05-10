package main

// Per-project web config: port + bind addr + optional auth token.
//
// First-load port pick is deterministic (sha256 of the project key, mod 50,
// added to 7681). On bind failure we walk the 7681..7730 range; on full
// exhaustion we fall back to an ephemeral port. Any port chosen that differs
// from what's currently on disk is written back so subsequent restarts reuse
// the same port.

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	portRangeStart = 7681
	portRangeSize  = 50
)

type WebConfig struct {
	Port      int
	Bind      string
	AuthToken string
}

// hashedPort returns the deterministic first-pick port for a project key.
func hashedPort(projectKey string) int {
	sum := sha256.Sum256([]byte(projectKey))
	n := binary.BigEndian.Uint32(sum[:4])
	return portRangeStart + int(n%uint32(portRangeSize))
}

// nextFreePort tries `start` first, then walks the 7681..7730 range. Returns
// the first port whose TCP bind succeeds, or 0 if all 50 are taken.
func nextFreePort(bind string, start int) int {
	if start < portRangeStart || start >= portRangeStart+portRangeSize {
		start = portRangeStart
	}
	for i := 0; i < portRangeSize; i++ {
		p := portRangeStart + ((start - portRangeStart + i) % portRangeSize)
		l, err := net.Listen("tcp", fmt.Sprintf("%s:%d", bind, p))
		if err == nil {
			_ = l.Close()
			return p
		}
	}
	return 0
}

// loadOrAssignPort reads web/config.toml, picks/keeps a port, rewrites the
// file if the port changed, and returns the resulting config. The caller is
// responsible for actually binding the port (race-free reservation isn't
// possible without holding the listener; small race window is acceptable for
// this single-user, per-project model).
// readExistingConfig reads `webPath/config.toml` without doing any
// port assignment. Returns nil if the file doesn't exist or doesn't
// declare a usable port — used by main.go to discover the running
// server's port for a /api/version probe before deciding whether to
// preempt or defer.
func readExistingConfig(webPath string) *WebConfig {
	data, err := os.ReadFile(filepath.Join(webPath, "config.toml"))
	if err != nil {
		return nil
	}
	cfg := &WebConfig{Bind: "127.0.0.1"}
	parseTOML(string(data), cfg)
	if cfg.Port == 0 {
		return nil
	}
	return cfg
}

func loadOrAssignPort(webPath, projectKeyStr string) (*WebConfig, error) {
	cfgPath := filepath.Join(webPath, "config.toml")
	cfg := &WebConfig{Bind: "127.0.0.1"}
	if data, err := os.ReadFile(cfgPath); err == nil {
		parseTOML(string(data), cfg)
	}
	target := cfg.Port
	if target == 0 {
		target = hashedPort(projectKeyStr)
	}
	chosen := nextFreePort(cfg.Bind, target)
	if chosen == 0 {
		// All 50 ports taken — fall back to an ephemeral port.
		l, err := net.Listen("tcp", cfg.Bind+":0")
		if err != nil {
			return nil, fmt.Errorf("no free port in 7681..7730 and ephemeral failed: %w", err)
		}
		chosen = l.Addr().(*net.TCPAddr).Port
		_ = l.Close()
	}
	if chosen != cfg.Port {
		cfg.Port = chosen
		if err := os.MkdirAll(webPath, 0o755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(cfgPath, []byte(formatTOML(cfg)), 0o644); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// formatTOML emits the canonical 3-key schema. Stable output; safe to diff.
func formatTOML(c *WebConfig) string {
	var sb strings.Builder
	sb.WriteString("[web]\n")
	sb.WriteString(fmt.Sprintf("port = %d\n", c.Port))
	sb.WriteString(fmt.Sprintf("bind = %q\n", c.Bind))
	sb.WriteString(fmt.Sprintf("auth_token = %q\n", c.AuthToken))
	return sb.String()
}

// parseTOML is a minimal line-based parser for our [web] schema. We control
// both reads and writes, so a 30-line parser beats taking a dependency.
func parseTOML(s string, c *WebConfig) {
	inWeb := false
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if line == "[web]" {
			inWeb = true
			continue
		}
		if strings.HasPrefix(line, "[") {
			inWeb = false
			continue
		}
		if !inWeb {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"`)
		switch key {
		case "port":
			if n, err := strconv.Atoi(val); err == nil {
				c.Port = n
			}
		case "bind":
			c.Bind = val
		case "auth_token":
			c.AuthToken = val
		}
	}
}
