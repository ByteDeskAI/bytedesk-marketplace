package main

// Project-key derivation, mirroring the bash _canonical_dir / _project_key
// helpers in fleet/bin/claude-sessions so that the web server lands on the
// same key the rest of the plugin uses.
//
// The web monitor is started by Claude Code with an unknown cwd. We honor
// $CLAUDE_PROJECT_DIR first (Claude Code injects it), then fall back to the
// process working directory.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// canonicalDir returns the project's canonical working-tree directory.
//
//	if `git rev-parse --git-common-dir` resolves under cwd:
//	    canonical = dirname(realpath(common-dir))
//	else:
//	    canonical = realpath(cwd)
//
// `--git-common-dir` returns the *main* repo's `.git` from any worktree, so
// fleet child sessions running inside `<repo>/.claude/worktrees/...` share the
// parent's PROJECT_KEY automatically.
func canonicalDir() (string, error) {
	cwd := os.Getenv("CLAUDE_PROJECT_DIR")
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			return "", fmt.Errorf("getwd: %w", err)
		}
	}
	cmd := exec.Command("git", "-C", cwd, "rev-parse", "--git-common-dir")
	if out, err := cmd.Output(); err == nil {
		gcd := strings.TrimSpace(string(out))
		if gcd != "" {
			if !filepath.IsAbs(gcd) {
				gcd = filepath.Join(cwd, gcd)
			}
			real, err := filepath.EvalSymlinks(gcd)
			if err == nil {
				return filepath.Dir(real), nil
			}
		}
	}
	real, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return cwd, nil
	}
	return real, nil
}

// projectKey returns the 12-char sha256 prefix of the canonical dir.
//
// Important: matches the bash CLI (`fleet/bin/spawn-claude-feature`,
// `claude-sessions`) which pipes the canonical dir through `sha256sum`
// — a UNIX shell pipeline appends a trailing newline. We replicate that
// here so the dashboard server lands on the SAME project key as
// every spawn-claude-feature invocation; otherwise child sessions
// land in a sibling project dir the dashboard never sees.
func projectKey() (string, error) {
	dir, err := canonicalDir()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(dir + "\n"))
	return hex.EncodeToString(sum[:])[:12], nil
}

// dataRoot returns ${CLAUDE_PLUGIN_DATA} or the documented fallback.
func dataRoot() string {
	if v := os.Getenv("CLAUDE_PLUGIN_DATA"); v != "" {
		return v
	}
	return filepath.Join(os.Getenv("HOME"), ".claude", "plugins", "data", "fleet")
}

func projectDir() (string, error) {
	key, err := projectKey()
	if err != nil {
		return "", err
	}
	return filepath.Join(dataRoot(), "projects", key), nil
}

func webDir() (string, error) {
	p, err := projectDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(p, "web"), nil
}
