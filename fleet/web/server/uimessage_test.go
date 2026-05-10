package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Table-driven test: feed synthetic jsonl lines through readUIMessages
// and assert the projected UIMessage[] shape.
func TestProjectMessages(t *testing.T) {
	cases := []struct {
		name    string
		lines   []string
		wantLen int
		check   func(t *testing.T, msgs []UIMessage)
	}{
		{
			name: "user text + assistant text",
			lines: []string{
				`{"type":"user","uuid":"u1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"user","content":[{"type":"text","text":"hello"}]}}`,
				`{"type":"assistant","uuid":"a1","timestamp":"2026-05-10T00:00:01Z","message":{"role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"hi"}]}}`,
			},
			wantLen: 2,
			check: func(t *testing.T, msgs []UIMessage) {
				if msgs[0].Role != "user" || msgs[0].Parts[0].Text != "hello" {
					t.Errorf("user msg wrong: %+v", msgs[0])
				}
				if msgs[1].Role != "assistant" || msgs[1].Parts[0].Text != "hi" {
					t.Errorf("assistant msg wrong: %+v", msgs[1])
				}
			},
		},
		{
			name: "tool_use folded with tool_result",
			lines: []string{
				`{"type":"assistant","uuid":"a1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"tu_123","name":"Bash","input":{"command":"ls"}}]}}`,
				`{"type":"user","uuid":"u1","timestamp":"2026-05-10T00:00:01Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_123","content":"a.txt\nb.txt","is_error":false}]}}`,
			},
			wantLen: 1, // tool_result folds INTO tool_use, no second message
			check: func(t *testing.T, msgs []UIMessage) {
				if len(msgs[0].Parts) != 1 {
					t.Fatalf("want 1 part, got %d", len(msgs[0].Parts))
				}
				p := msgs[0].Parts[0]
				if p.Type != "tool-call" || p.ToolName != "Bash" {
					t.Errorf("expected tool-call Bash, got %+v", p)
				}
				if p.State != "done" {
					t.Errorf("state=%s want done", p.State)
				}
				if p.Output != "a.txt\nb.txt" {
					t.Errorf("output=%q", p.Output)
				}
			},
		},
		{
			name: "Task tool surfaces sub_agent_id",
			lines: []string{
				`{"type":"assistant","uuid":"a1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"tu_t","name":"Task","input":{"subagent_type":"general-purpose","prompt":"go look"}}]}}`,
			},
			wantLen: 1,
			check: func(t *testing.T, msgs []UIMessage) {
				p := msgs[0].Parts[0]
				if p.SubAgentID != "general-purpose" {
					t.Errorf("expected SubAgentID=general-purpose, got %q", p.SubAgentID)
				}
			},
		},
		{
			name: "thinking block kept; signature dropped",
			lines: []string{
				`{"type":"assistant","uuid":"a1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"let me think","signature":"opaque"}]}}`,
			},
			wantLen: 1,
			check: func(t *testing.T, msgs []UIMessage) {
				p := msgs[0].Parts[0]
				if p.Type != "thinking" || p.Text != "let me think" {
					t.Errorf("got %+v", p)
				}
			},
		},
		{
			name: "system compact_boundary surfaced; turn_duration dropped",
			lines: []string{
				`{"type":"system","uuid":"s1","timestamp":"2026-05-10T00:00:00Z","subtype":"compact_boundary"}`,
				`{"type":"system","uuid":"s2","timestamp":"2026-05-10T00:00:01Z","subtype":"turn_duration","durationMs":1234}`,
				`{"type":"system","uuid":"s3","timestamp":"2026-05-10T00:00:02Z","subtype":"api_error"}`,
			},
			wantLen: 2, // turn_duration dropped
			check: func(t *testing.T, msgs []UIMessage) {
				if msgs[0].Parts[0].Subtype != "compact_boundary" {
					t.Errorf("first should be compact_boundary, got %+v", msgs[0])
				}
				if msgs[1].Parts[0].Subtype != "api_error" {
					t.Errorf("second should be api_error, got %+v", msgs[1])
				}
			},
		},
		{
			name: "image content collapsed to placeholder",
			lines: []string{
				`{"type":"user","uuid":"u1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"AAA"}}]}}`,
			},
			wantLen: 1,
			check: func(t *testing.T, msgs []UIMessage) {
				if msgs[0].Parts[0].Type != "text" || msgs[0].Parts[0].Text != "[image]" {
					t.Errorf("expected [image] placeholder, got %+v", msgs[0].Parts[0])
				}
			},
		},
		{
			name: "tool_result without prior tool_use survives",
			lines: []string{
				`{"type":"user","uuid":"u1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"orphan","content":"oops"}]}}`,
			},
			wantLen: 1,
			check: func(t *testing.T, msgs []UIMessage) {
				p := msgs[0].Parts[0]
				if p.Type != "tool-result" || p.Output != "oops" {
					t.Errorf("got %+v", p)
				}
			},
		},
		{
			name: "tool_result content as array of text blocks",
			lines: []string{
				`{"type":"assistant","uuid":"a1","timestamp":"2026-05-10T00:00:00Z","message":{"role":"assistant","stop_reason":"tool_use","content":[{"type":"tool_use","id":"tu_a","name":"Read","input":{}}]}}`,
				`{"type":"user","uuid":"u1","timestamp":"2026-05-10T00:00:01Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tu_a","content":[{"type":"text","text":"line 1"},{"type":"text","text":"line 2"}]}]}}`,
			},
			wantLen: 1,
			check: func(t *testing.T, msgs []UIMessage) {
				p := msgs[0].Parts[0]
				if p.Output != "line 1\nline 2" {
					t.Errorf("output=%q", p.Output)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := writeJSONL(t, tc.lines)
			msgs, err := readUIMessages(path, 0)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if len(msgs) != tc.wantLen {
				t.Fatalf("want %d msgs, got %d: %s", tc.wantLen, len(msgs), pretty(msgs))
			}
			tc.check(t, msgs)
		})
	}
}

func TestReadUIMessagesRespectsLimit(t *testing.T) {
	lines := make([]string, 50)
	for i := range lines {
		lines[i] = `{"type":"assistant","uuid":"u","timestamp":"2026-05-10T00:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}`
	}
	path := writeJSONL(t, lines)
	msgs, err := readUIMessages(path, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 10 {
		t.Errorf("want 10, got %d", len(msgs))
	}
}

func TestSanitizeProjectDir(t *testing.T) {
	cases := []struct{ in, want string }{
		{"/home/u/repo", "-home-u-repo"},
		// Worktree under /.claude/ — both `/` AND `.` must be replaced
		// to match what claude itself writes under ~/.claude/projects/.
		{"/home/u/repo/.claude/worktrees/X", "-home-u-repo--claude-worktrees-X"},
		{"/some/dotted.dir/path", "-some-dotted-dir-path"},
	}
	for _, c := range cases {
		got := sanitizeProjectDir(c.in)
		if got != c.want {
			t.Errorf("sanitize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func writeJSONL(t *testing.T, lines []string) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "t.jsonl")
	body := ""
	for _, l := range lines {
		body += l + "\n"
	}
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func pretty(msgs []UIMessage) string {
	b, _ := json.MarshalIndent(msgs, "", "  ")
	return string(b)
}
