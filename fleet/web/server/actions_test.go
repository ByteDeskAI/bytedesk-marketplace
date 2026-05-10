package main

import "testing"

// Tmux key allowlist guards the /keys endpoint. The list must accept
// the keys an AskUserQuestion form needs (Up, Down, Space, Enter) and
// reject anything that could be exploited as injection (semicolons,
// shell metacharacters, raw text). Pure unit test — does NOT shell
// out — so it's safe to run in CI without tmux.
func TestAllowedTmuxKeys(t *testing.T) {
	cases := []struct {
		name string
		keys []string
		ok   bool
	}{
		{"navigate down then enter", []string{"Down", "Down", "Enter"}, true},
		{"multi-select toggle", []string{"Down", "Space", "Down", "Space", "Enter"}, true},
		{"escape to cancel", []string{"Escape"}, true},
		{"injection via semicolon", []string{"; rm -rf /"}, false},
		{"injection via backtick", []string{"`whoami`"}, false},
		{"raw text rejected", []string{"hello"}, false},
		{"mix valid + invalid rejected as a whole", []string{"Down", "evil"}, false},
		{"empty rejected by handler (allowlist would say ok)", []string{}, true}, // handler rejects empty separately
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			allOk := true
			for _, k := range c.keys {
				if _, ok := allowedTmuxKeys[k]; !ok {
					allOk = false
					break
				}
			}
			if allOk != c.ok {
				t.Errorf("keys=%v allowed=%v, want %v", c.keys, allOk, c.ok)
			}
		})
	}
}
