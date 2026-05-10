package main

// uimessage.go — projects Claude Code transcript jsonl into the
// `UIMessage[]` shape understood by `@tanstack/ai-react` so chat-mode
// tiles can render structured turns (text / thinking / tool-call /
// tool-result) instead of ANSI from the rendered terminal.
//
// Wire shape lives Go-side so the same projection feeds both the
// /messages bootstrap endpoint and the SSE delta stream.
//
// Design notes:
//   - tool_use / tool_result are paired by `tool_use_id` and shipped
//     as a single ToolCallPart with `state: "running" | "done" | "error"`
//     and an `output` field once the result lands.
//   - Image content is dropped (per parsing rule — base64 blobs are
//     huge and not useful for chat triage). Replaced with a small
//     `[image]` placeholder text part.
//   - Thinking blocks keep `text` but drop `signature` (opaque, not
//     surfaced).
//   - System events surface only the high-signal subtypes:
//     `compact_boundary` and `api_error`. Everything else (turn_duration,
//     stop_hook_summary, away_summary, local_command, …) is dropped —
//     it's already aggregated into TicketStats.

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"
)

// UIMessage — top-level message in a chat thread. Mirrors the shape
// `@tanstack/ai-react` consumes (one `parts` array per role).
type UIMessage struct {
	ID        string    `json:"id"`
	Role      string    `json:"role"` // user | assistant | system
	Timestamp time.Time `json:"timestamp"`
	AgentID   string    `json:"agent_id,omitempty"` // sub-agent threads only
	Parts     []UIPart  `json:"parts"`
}

// UIPart — discriminated union over message-part types. The shape is
// chosen to match TanStack AI's UIMessage parts; rendered by the
// MessageBubble component on the client.
type UIPart struct {
	Type string `json:"type"` // text | thinking | tool-call | tool-result | system

	// text / thinking / system
	Text string `json:"text,omitempty"`

	// tool-call (paired with tool-result by ToolUseID)
	ToolUseID string         `json:"tool_use_id,omitempty"`
	ToolName  string         `json:"tool_name,omitempty"`
	Input     map[string]any `json:"input,omitempty"`
	State     string         `json:"state,omitempty"`  // running | done | error
	Output    string         `json:"output,omitempty"` // tool_result text once it lands

	// tool-call carrying a sub-agent invocation (Task tool). When
	// present, the client renders the corresponding sub-agent thread
	// nested under this part.
	SubAgentID string `json:"sub_agent_id,omitempty"`

	// system subtype (compact_boundary / api_error)
	Subtype string `json:"subtype,omitempty"`
}

// richEntry decodes more of the jsonl event than `transcriptEntry`
// does — we need full `tool_use_id`, `input`, and the raw content
// blocks so we can pair tool_use ↔ tool_result.
type richEntry struct {
	Type        string    `json:"type"`
	UUID        string    `json:"uuid"`
	Timestamp   time.Time `json:"timestamp"`
	IsSidechain bool      `json:"isSidechain"`
	Message     struct {
		Role       string            `json:"role"`
		StopReason string            `json:"stop_reason"`
		Content    []json.RawMessage `json:"content"`
	} `json:"message"`
	// Bare-text fallback (some legacy entries put the user prompt at
	// the top level rather than under message.content).
	AITitle    string `json:"aiTitle"`
	AgentName  string `json:"agentName"`
	LastPrompt string `json:"lastPrompt"`
	// system subtype lives at top-level
	Subtype string `json:"subtype"`
}

type contentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	Thinking  string          `json:"thinking"`
	Name      string          `json:"name"`        // tool_use
	ID        string          `json:"id"`          // tool_use
	Input     map[string]any  `json:"input"`       // tool_use
	ToolUseID string          `json:"tool_use_id"` // tool_result
	IsError   bool            `json:"is_error"`    // tool_result
	Content   json.RawMessage `json:"content"`     // tool_result body (string or array)
}

// readUIMessages reads up to `limit` UIMessages from the tail of the
// jsonl at `path`. Negative limit = unlimited. When `beforeID` is
// non-empty, returns the slice ending at (but not including) the
// message whose ID matches — used by the chat-mode infinite-scroll-up
// path to load older history.
func readUIMessages(path string, limit int, beforeID string) ([]UIMessage, error) {
	if path == "" {
		return nil, errors.New("empty path")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var entries []richEntry
	for sc.Scan() {
		var e richEntry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue
		}
		entries = append(entries, e)
	}
	if err := sc.Err(); err != nil && !errors.Is(err, bufio.ErrTooLong) {
		return nil, err
	}
	msgs := projectMessages(entries)
	if beforeID != "" {
		// Slice the array up to (not including) the matching ID.
		// Unknown ID → return empty (caller will treat as "no more").
		cut := -1
		for i, m := range msgs {
			if m.ID == beforeID {
				cut = i
				break
			}
		}
		if cut <= 0 {
			return []UIMessage{}, nil
		}
		msgs = msgs[:cut]
	}
	if limit > 0 && len(msgs) > limit {
		msgs = msgs[len(msgs)-limit:]
	}
	return msgs, nil
}

// projectMessages walks a chronologically-ordered slice of entries
// and produces the UIMessage[] tail. Tool calls are pairedby
// tool_use_id; the tool-result is folded into the matching tool-call
// part rather than landing as its own message.
func projectMessages(entries []richEntry) []UIMessage {
	msgs := make([]UIMessage, 0, len(entries))
	// toolCallIndex: tool_use_id → (msg index, part index) so we can
	// fold the eventual tool_result into the same part.
	type partRef struct{ m, p int }
	toolCallIndex := map[string]partRef{}

	for _, e := range entries {
		switch e.Type {
		case "user", "assistant":
			parts, refs := projectContent(e.Message.Content, e.Type == "user")
			if len(parts) == 0 {
				continue
			}
			// Fold tool_result parts into earlier tool-call parts when
			// we have a match; collect any others for emission.
			folded := make([]UIPart, 0, len(parts))
			for _, p := range parts {
				if p.Type == "tool-result" {
					if ref, ok := toolCallIndex[p.ToolUseID]; ok {
						msgs[ref.m].Parts[ref.p].Output = p.Output
						msgs[ref.m].Parts[ref.p].State = p.State
						continue
					}
				}
				folded = append(folded, p)
			}
			if len(folded) == 0 {
				continue
			}
			msgs = append(msgs, UIMessage{
				ID:        e.UUID,
				Role:      e.Type,
				Timestamp: e.Timestamp,
				Parts:     folded,
			})
			// Remember tool-call positions for later folding.
			mIdx := len(msgs) - 1
			for pIdx, part := range folded {
				if part.Type == "tool-call" && part.ToolUseID != "" {
					toolCallIndex[part.ToolUseID] = partRef{m: mIdx, p: pIdx}
					_ = refs // refs reserved for future cross-block bookkeeping
				}
			}
		case "system":
			if e.Subtype == "compact_boundary" || e.Subtype == "api_error" {
				msgs = append(msgs, UIMessage{
					ID:        e.UUID,
					Role:      "system",
					Timestamp: e.Timestamp,
					Parts: []UIPart{{
						Type:    "system",
						Subtype: e.Subtype,
						Text:    systemSubtypeLabel(e.Subtype),
					}},
				})
			}
			// drop other subtypes — they're already in TicketStats
			// last-prompt / ai-title / agent-name / permission-mode /
			// pr-link / queue-operation are metadata — the user prompt
			// itself is captured via the `user` entry's text content
			// above, so projecting last-prompt as a separate user
			// message would duplicate every typed prompt (BDM-42). Skip.
		}
	}
	return msgs
}

// projectContent decodes raw `content[]` JSON into UIParts. The bool
// `userSide` flips the default role-of-text from "assistant" tone to
// "user". Returns parts and a placeholder slice for future use.
func projectContent(blocks []json.RawMessage, userSide bool) ([]UIPart, []string) {
	out := make([]UIPart, 0, len(blocks))
	for _, raw := range blocks {
		var c contentBlock
		if err := json.Unmarshal(raw, &c); err != nil {
			continue
		}
		switch c.Type {
		case "text":
			if c.Text == "" {
				continue
			}
			out = append(out, UIPart{Type: "text", Text: c.Text})
		case "thinking":
			t := c.Thinking
			if t == "" {
				t = c.Text
			}
			if t == "" {
				continue
			}
			out = append(out, UIPart{Type: "thinking", Text: t})
		case "tool_use":
			part := UIPart{
				Type:      "tool-call",
				ToolUseID: c.ID,
				ToolName:  c.Name,
				Input:     c.Input,
				State:     "running",
			}
			// Detect Task tool — pull out the subagent_type from input
			// for nested-thread routing on the client.
			if c.Name == "Task" && c.Input != nil {
				if v, ok := c.Input["subagent_type"].(string); ok {
					part.SubAgentID = v
				}
			}
			out = append(out, part)
		case "tool_result":
			out = append(out, UIPart{
				Type:      "tool-result",
				ToolUseID: c.ToolUseID,
				Output:    flattenToolResult(c.Content),
				State:     resultState(c.IsError),
			})
		case "image":
			out = append(out, UIPart{Type: "text", Text: "[image]"})
		}
		_ = userSide
	}
	return out, nil
}

func flattenToolResult(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// Try string form first.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	// Then array of {type:"text", text:"..."} blocks.
	var arr []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &arr); err == nil {
		buf := ""
		for _, b := range arr {
			if b.Type == "text" && b.Text != "" {
				if buf != "" {
					buf += "\n"
				}
				buf += b.Text
			}
		}
		return buf
	}
	return string(raw)
}

func resultState(isErr bool) string {
	if isErr {
		return "error"
	}
	return "done"
}

func systemSubtypeLabel(sub string) string {
	switch sub {
	case "compact_boundary":
		return "↺ context compacted"
	case "api_error":
		return "⚠ API error"
	}
	return fmt.Sprintf("[system: %s]", sub)
}
