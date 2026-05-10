package main

// transcript_stream.go — tails per-session Claude Code transcript
// jsonl files, parses each new line into typed events, updates a
// per-ticket stats cache, and fans out via the EventBus.
//
// One TranscriptTailer goroutine runs per active session. Lifecycle:
//   - Started by TranscriptStream.ensure(ticket, worktree) when a
//     session is discovered.
//   - Reads from EOF forward (we only care about new bytes; historical
//     state is recovered by walking the file tail once on startup).
//   - Stops when the file is gone, the session is reaped, or the
//     dashboard exits.
//
// Each tailer keeps its own buffered Scanner. We DO NOT block on
// fsnotify — a 250ms poll-tick is fine for jsonl lines arriving every
// few seconds.

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// TicketStats — server-side cache of decoded transcript signals per
// ticket. Returned by /api/sessions/<T>/stats; used by tile headers
// and the session detail panel.
type TicketStats struct {
	Ticket          string         `json:"ticket"`
	AITitle         string         `json:"ai_title,omitempty"`
	AgentName       string         `json:"agent_name,omitempty"`
	LastPrompt      string         `json:"last_prompt,omitempty"`
	PermissionMode  string         `json:"permission_mode,omitempty"`
	PRNumber        int            `json:"pr_number,omitempty"`
	PRURL           string         `json:"pr_url,omitempty"`
	Tools           map[string]int `json:"tools,omitempty"` // tool_name → call count
	ToolTotal       int            `json:"tool_total"`
	TokensIn        int64          `json:"tokens_in"`
	TokensOut       int64          `json:"tokens_out"`
	TokensCacheHit  int64          `json:"tokens_cache_hit"`
	CostUSD         float64        `json:"cost_usd"`
	Errors          int            `json:"errors"`
	APIErrors       int            `json:"api_errors"`
	ThinkingChars   int            `json:"thinking_chars"`
	Compactions     int            `json:"compactions"`
	QueueDepth      int            `json:"queue_depth"`
	LastTurnAt      time.Time      `json:"last_turn_at,omitempty"`
	LastStopReason  string         `json:"last_stop_reason,omitempty"`
	LastTurnDurMs   int64          `json:"last_turn_duration_ms,omitempty"`
	ToolLatencyMs   map[string]int64 `json:"tool_latency_ms,omitempty"` // tool_name → p50 ms (rolling)
	SubAgents       []SubAgentInfo  `json:"sub_agents,omitempty"`     // discovered sub-agent transcripts
	UpdatedAt       time.Time      `json:"updated_at"`
}

// SubAgentInfo summarizes one sub-agent transcript file
// (`subagents/agent-<id>.jsonl`). Populated by sub-agent tailers in
// transcript_stream.go; surfaced via TicketStats.SubAgents and used
// by the chat-mode UI to render nested threads + by the terminal-mode
// UI to render per-agent tabs.
type SubAgentInfo struct {
	AgentID    string         `json:"agent_id"`
	AgentName  string         `json:"agent_name,omitempty"`
	Started    time.Time      `json:"started,omitempty"`
	LastEvent  time.Time      `json:"last_event,omitempty"`
	Status     string         `json:"status"` // "running" | "done" | "error"
	Tools      map[string]int `json:"tools,omitempty"`
	ToolTotal  int            `json:"tool_total"`
	TokensIn   int64          `json:"tokens_in"`
	TokensOut  int64          `json:"tokens_out"`
	Errors     int            `json:"errors"`
}

// TranscriptEvent — decoded jsonl line republished onto the EventBus
// under topic `transcript.<TICKET>`. Keep this small; UI subscribes to
// these for live "what's claude doing now" feeds.
//
// AgentID is "" for parent transcript events and set to the sub-agent
// id when the event came from a `subagents/agent-<id>.jsonl` file.
// Lets the client route the event to the right thread in chat mode
// and the right tab in terminal mode.
type TranscriptEvent struct {
	Ticket    string         `json:"ticket"`
	AgentID   string         `json:"agent_id,omitempty"`
	Type      string         `json:"type"`               // text|thinking|tool_use|tool_result|stop|pr|error|prompt|compact|...
	Timestamp time.Time      `json:"timestamp"`
	ToolName  string         `json:"tool_name,omitempty"`
	Text      string         `json:"text,omitempty"`     // truncated to ~512 chars
	Detail    map[string]any `json:"detail,omitempty"`
}

// TranscriptStream owns all active tailers + the per-ticket stats
// cache. There's one TranscriptStream per dashboard server.
//
// Two flavors of tailer share the same machinery:
//   - parent tailer: keyed by ticket; reads the most-recent .jsonl
//     for the worktree's sanitized-cwd dir.
//   - sub-agent tailer: keyed by ticket+agentID; reads
//     `<dir>/subagents/agent-<id>.jsonl`.
//
// Sub-agent stats accumulate into the parent's TicketStats.SubAgents
// slice so a single Stats(ticket) call surfaces the full tree.
type TranscriptStream struct {
	deps       *apiDeps
	mu         sync.RWMutex
	stats      map[string]*TicketStats
	tailers    map[string]*transcriptTailer
	subTailers map[string]*transcriptTailer // key: "<ticket>/<agentID>"
}

func NewTranscriptStream(deps *apiDeps) *TranscriptStream {
	return &TranscriptStream{
		deps:       deps,
		stats:      map[string]*TicketStats{},
		tailers:    map[string]*transcriptTailer{},
		subTailers: map[string]*transcriptTailer{},
	}
}

// Run reconciles every 3 seconds: tailers are started for newly-
// discovered active sessions and stopped for sessions that reached a
// terminal state. Cancellation of ctx tears down all tailers.
func (ts *TranscriptStream) Run(ctx context.Context) {
	go func() {
		t := time.NewTicker(3 * time.Second)
		defer t.Stop()
		ts.reconcile() // initial pass
		for {
			select {
			case <-ctx.Done():
				ts.shutdown()
				return
			case <-t.C:
				ts.reconcile()
			}
		}
	}()
}

func (ts *TranscriptStream) shutdown() {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	for _, t := range ts.tailers {
		t.stopOnce.Do(func() { close(t.stop) })
	}
	for _, t := range ts.subTailers {
		t.stopOnce.Do(func() { close(t.stop) })
	}
	ts.tailers = map[string]*transcriptTailer{}
	ts.subTailers = map[string]*transcriptTailer{}
}

type transcriptTailer struct {
	ticket   string
	agentID  string // "" for parent
	path     string
	stop     chan struct{}
	stopOnce sync.Once
}

// reconcile walks the SessionRepo, starts a tailer for every active
// session that lacks one, and stops tailers for sessions that are gone
// or reaped (state == done/completed). Also reconciles sub-agent
// tailers under each active session — when claude invokes the Task
// tool, a new agent-<id>.jsonl appears in `subagents/`; we pick it up
// on the next 3-second tick and start a tailer for it.
func (ts *TranscriptStream) reconcile() {
	sessions, err := ts.deps.sessions.List()
	if err != nil {
		return
	}
	wantPath := map[string]string{}                   // ticket → parent jsonl path
	wantSub := map[string]map[string]string{}         // ticket → agentID → sub-agent jsonl path
	worktrees := map[string]string{}                  // ticket → worktree (for sub-agent discovery)
	for _, s := range sessions {
		if s.State == "done" || s.State == "completed" {
			continue
		}
		p := findTranscript(s.Worktree)
		if p == "" {
			continue
		}
		wantPath[s.Ticket] = p
		worktrees[s.Ticket] = s.Worktree
		subs := findSubAgentTranscripts(s.Worktree)
		if len(subs) > 0 {
			m := make(map[string]string, len(subs))
			for _, f := range subs {
				m[f.AgentID] = f.Path
			}
			wantSub[s.Ticket] = m
		}
	}
	// Synthesise a tailer for the always-on main terminal so chat-
	// mode in the main tile can subscribe to live deltas (BDM-32).
	if main := mainWorktree(ts.deps); main != "" {
		if p := findTranscript(main); p != "" {
			wantPath[mainTicket] = p
		}
	}

	ts.mu.Lock()
	defer ts.mu.Unlock()
	// Stop tailers no longer wanted (or pointing at a different file
	// — sub-agent transcripts can rotate between files).
	for ticket, t := range ts.tailers {
		if wantPath[ticket] != t.path {
			t.stopOnce.Do(func() { close(t.stop) })
			delete(ts.tailers, ticket)
		}
	}
	// Start tailers for new sessions.
	for ticket, path := range wantPath {
		if _, has := ts.tailers[ticket]; has {
			continue
		}
		t := &transcriptTailer{ticket: ticket, path: path, stop: make(chan struct{})}
		ts.tailers[ticket] = t
		go ts.runTailer(t)
	}

	// Sub-agent reconcile. Stop any sub-tailer whose ticket is gone
	// or whose path drifted; start tailers for newly-discovered files.
	for key, t := range ts.subTailers {
		want, hasTicket := wantSub[t.ticket]
		if !hasTicket || want[t.agentID] != t.path {
			t.stopOnce.Do(func() { close(t.stop) })
			delete(ts.subTailers, key)
		}
	}
	for ticket, agents := range wantSub {
		for agentID, path := range agents {
			key := ticket + "/" + agentID
			if _, has := ts.subTailers[key]; has {
				continue
			}
			t := &transcriptTailer{ticket: ticket, agentID: agentID, path: path, stop: make(chan struct{})}
			ts.subTailers[key] = t
			go ts.runTailer(t)
		}
	}
}

func (ts *TranscriptStream) runTailer(t *transcriptTailer) {
	apply := func(e *transcriptEntry, publish bool) {
		if t.agentID == "" {
			ts.applyEntry(t.ticket, e, publish)
			return
		}
		ts.applySubAgentEntry(t.ticket, t.agentID, e, publish)
	}

	// Backfill — replay the existing file once into the stats so the
	// cache has full counts before we emit fresh events.
	if entries, err := readTranscriptTail(t.path, 5000); err == nil {
		for i := range entries {
			apply(&entries[i], false)
		}
	}

	f, err := os.Open(t.path)
	if err != nil {
		return
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		return
	}
	r := bufio.NewReaderSize(f, 1<<16)

	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-tick.C:
		}
		for {
			line, err := r.ReadBytes('\n')
			if len(line) > 0 {
				var entry transcriptEntry
				if json.Unmarshal(line, &entry) == nil {
					apply(&entry, true)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("transcript tailer %s/%s: read err: %v", t.ticket, t.agentID, err)
				return
			}
		}
	}
}

// applySubAgentEntry mutates the parent's TicketStats.SubAgents slice
// (one element per agent_id) and publishes a TranscriptEvent with
// AgentID set so the client can route the event to the right thread.
func (ts *TranscriptStream) applySubAgentEntry(ticket, agentID string, e *transcriptEntry, publish bool) {
	ts.mu.Lock()
	st := ts.stats[ticket]
	if st == nil {
		st = &TicketStats{Ticket: ticket, Tools: map[string]int{}, ToolLatencyMs: map[string]int64{}}
		ts.stats[ticket] = st
	}
	// Find or create the SubAgentInfo entry.
	var info *SubAgentInfo
	for i := range st.SubAgents {
		if st.SubAgents[i].AgentID == agentID {
			info = &st.SubAgents[i]
			break
		}
	}
	if info == nil {
		st.SubAgents = append(st.SubAgents, SubAgentInfo{
			AgentID: agentID,
			Status:  "running",
			Tools:   map[string]int{},
		})
		info = &st.SubAgents[len(st.SubAgents)-1]
	}
	if info.Tools == nil {
		info.Tools = map[string]int{}
	}
	if !e.Timestamp.IsZero() && (info.Started.IsZero() || e.Timestamp.Before(info.Started)) {
		info.Started = e.Timestamp
	}
	if !e.Timestamp.IsZero() {
		info.LastEvent = e.Timestamp
	}

	raw := mapFromEntry(e)
	switch e.Type {
	case "agent-name":
		if v, _ := raw["agentName"].(string); v != "" {
			info.AgentName = v
		}
	case "assistant":
		// Tally token usage if present.
		if u, _ := raw["message"].(map[string]any); u != nil {
			if usage, _ := u["usage"].(map[string]any); usage != nil {
				if v, _ := usage["input_tokens"].(float64); v > 0 {
					info.TokensIn += int64(v)
				}
				if v, _ := usage["output_tokens"].(float64); v > 0 {
					info.TokensOut += int64(v)
				}
			}
		}
		for _, c := range e.Message.Content {
			if c.Type == "tool_use" {
				info.Tools[c.Name]++
				info.ToolTotal++
			}
		}
		if e.Message.StopReason == "end_turn" {
			info.Status = "done"
		}
		if e.Message.StopReason == "max_tokens" {
			info.Status = "error"
		}
	case "user":
		for _, c := range e.Message.Content {
			if c.Type == "tool_result" && c.IsError {
				info.Errors++
				info.Status = "error"
			}
		}
	}

	st.UpdatedAt = time.Now()
	ts.mu.Unlock()

	if publish {
		ts.publishWithAgent(ticket, agentID, e, raw)
	}
}

// publishWithAgent is publish() but stamps AgentID on the outgoing
// TranscriptEvent so subscribers can route it.
func (ts *TranscriptStream) publishWithAgent(ticket, agentID string, e *transcriptEntry, raw map[string]any) {
	out := buildTranscriptEvent(ticket, e, raw)
	out.AgentID = agentID
	ts.deps.bus.Publish(Message{Topic: Topic("transcript." + ticket), Body: out})
	ts.deps.bus.Publish(Message{Topic: Topic("transcript"), Body: out})
}

// applyEntry mutates per-ticket stats and (if `publish`) emits a
// TranscriptEvent on the bus.
func (ts *TranscriptStream) applyEntry(ticket string, e *transcriptEntry, publish bool) {
	ts.mu.Lock()
	st := ts.stats[ticket]
	if st == nil {
		st = &TicketStats{Ticket: ticket, Tools: map[string]int{}, ToolLatencyMs: map[string]int64{}}
		ts.stats[ticket] = st
	}
	defer func() {
		st.UpdatedAt = time.Now()
		ts.mu.Unlock()
	}()

	switch e.Type {
	case "ai-title":
		// AITitle sits at the top of `transcriptEntry`. The struct in
		// transcript.go only decoded `Type/Timestamp/Message`; pull the
		// extras from the raw json. We re-decode minimally here.
		// Skipped — handled in extended decoder below via raw map.
	}

	// For fields not in the typed struct, do a best-effort raw decode.
	// Re-marshal then decode into a generic map (cheap; ~tens of µs).
	raw := mapFromEntry(e)
	switch e.Type {
	case "ai-title":
		if v, _ := raw["aiTitle"].(string); v != "" {
			st.AITitle = v
		}
	case "agent-name":
		if v, _ := raw["agentName"].(string); v != "" {
			st.AgentName = v
		}
	case "last-prompt":
		if v, _ := raw["lastPrompt"].(string); v != "" {
			st.LastPrompt = v
		}
	case "permission-mode":
		if v, _ := raw["permissionMode"].(string); v != "" {
			st.PermissionMode = v
		}
	case "pr-link":
		if n, _ := raw["prNumber"].(float64); n > 0 {
			st.PRNumber = int(n)
		}
		if u, _ := raw["prUrl"].(string); u != "" {
			st.PRURL = u
		}
	case "queue-operation":
		if op, _ := raw["operation"].(string); op != "" {
			switch op {
			case "enqueue":
				st.QueueDepth++
			case "dequeue", "remove":
				if st.QueueDepth > 0 {
					st.QueueDepth--
				}
			}
		}
	case "system":
		if sub, _ := raw["subtype"].(string); sub != "" {
			switch sub {
			case "api_error":
				st.APIErrors++
			case "compact_boundary":
				st.Compactions++
			case "turn_duration":
				if d, _ := raw["durationMs"].(float64); d > 0 {
					st.LastTurnDurMs = int64(d)
				}
			}
		}
	case "assistant":
		if e.Message.StopReason != "" {
			st.LastStopReason = e.Message.StopReason
			if !e.Timestamp.IsZero() {
				st.LastTurnAt = e.Timestamp
			}
		}
		// Tally token usage if present.
		if u, _ := raw["message"].(map[string]any); u != nil {
			if usage, _ := u["usage"].(map[string]any); usage != nil {
				if v, _ := usage["input_tokens"].(float64); v > 0 {
					st.TokensIn += int64(v)
				}
				if v, _ := usage["output_tokens"].(float64); v > 0 {
					st.TokensOut += int64(v)
				}
				if v, _ := usage["cache_read_input_tokens"].(float64); v > 0 {
					st.TokensCacheHit += int64(v)
				}
				if v, _ := usage["cache_creation_input_tokens"].(float64); v > 0 {
					st.TokensIn += int64(v) // count cache-creation as input cost
				}
			}
		}
		// Walk content blocks for tool_use names + thinking length.
		for _, c := range e.Message.Content {
			switch c.Type {
			case "tool_use":
				st.Tools[c.Name]++
				st.ToolTotal++
			case "thinking":
				st.ThinkingChars += len(c.Text)
			}
		}
	case "user":
		// tool_result with is_error is surfaced as an error tally.
		for _, c := range e.Message.Content {
			if c.Type == "tool_result" && c.IsError {
				st.Errors++
			}
		}
	}

	// Cost: flat $5/Mtoken until we get pricing per model.
	st.CostUSD = float64(st.TokensIn+st.TokensOut+st.TokensCacheHit) * 5.0 / 1_000_000

	if publish {
		ts.publish(ticket, e, raw)
	}
}

// publish emits a TranscriptEvent on the bus. Topics:
//   transcript                  — every event from every session
//   transcript.<TICKET>         — only this session
func (ts *TranscriptStream) publish(ticket string, e *transcriptEntry, raw map[string]any) {
	out := buildTranscriptEvent(ticket, e, raw)
	ts.deps.bus.Publish(Message{Topic: Topic("transcript." + ticket), Body: out})
	ts.deps.bus.Publish(Message{Topic: Topic("transcript"), Body: out})
}

// buildTranscriptEvent shapes a TranscriptEvent from a parsed jsonl
// entry. Used by both parent (publish) and sub-agent (publishWithAgent)
// paths so the wire format stays identical.
func buildTranscriptEvent(ticket string, e *transcriptEntry, raw map[string]any) TranscriptEvent {
	out := TranscriptEvent{
		Ticket:    ticket,
		Type:      e.Type,
		Timestamp: e.Timestamp,
	}
	switch e.Type {
	case "assistant":
		if e.Message.StopReason != "" {
			out.Type = "stop"
			out.Detail = map[string]any{"stop_reason": e.Message.StopReason}
		}
		for _, c := range e.Message.Content {
			if c.Type == "tool_use" {
				out.Type = "tool_use"
				out.ToolName = c.Name
				break
			}
			if c.Type == "text" && c.Text != "" {
				out.Type = "text"
				out.Text = truncate(c.Text, 512)
				break
			}
			if c.Type == "thinking" && c.Text != "" {
				out.Type = "thinking"
				out.Text = truncate(c.Text, 512)
				break
			}
		}
	case "user":
		// User entries can carry tool_result blocks (claude's tool
		// loop reporting back) OR plain text the user typed at the
		// prompt. Distinguish so the chat can render typed input
		// live as a user message; previously these were silently
		// dropped on the SSE side and only appeared on /messages
		// refresh (BDM-39).
		for _, c := range e.Message.Content {
			if c.Type == "tool_result" {
				out.Type = "tool_result"
				if c.IsError {
					out.Type = "tool_error"
				}
				break
			}
			if c.Type == "text" && c.Text != "" {
				out.Type = "user_text"
				out.Text = truncate(c.Text, 1024)
				break
			}
		}
	case "pr-link":
		if u, _ := raw["prUrl"].(string); u != "" {
			out.Detail = map[string]any{"url": u}
			if n, _ := raw["prNumber"].(float64); n > 0 {
				out.Detail["number"] = int(n)
			}
		}
	case "system":
		if sub, _ := raw["subtype"].(string); sub != "" {
			out.Detail = map[string]any{"subtype": sub}
		}
	case "last-prompt":
		if v, _ := raw["lastPrompt"].(string); v != "" {
			out.Text = truncate(v, 512)
		}
	}
	return out
}

// Stats returns a deep copy of the per-ticket stats (safe for HTTP
// JSON encoding without holding the lock).
func (ts *TranscriptStream) Stats(ticket string) (TicketStats, bool) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	st, ok := ts.stats[ticket]
	if !ok {
		return TicketStats{}, false
	}
	return cloneStats(st), true
}

// AllStats returns a snapshot of every per-ticket stats record.
func (ts *TranscriptStream) AllStats() map[string]TicketStats {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	out := make(map[string]TicketStats, len(ts.stats))
	for k, v := range ts.stats {
		out[k] = cloneStats(v)
	}
	return out
}

func cloneStats(st *TicketStats) TicketStats {
	out := *st
	out.Tools = make(map[string]int, len(st.Tools))
	for k, v := range st.Tools {
		out.Tools[k] = v
	}
	if len(st.SubAgents) > 0 {
		out.SubAgents = make([]SubAgentInfo, len(st.SubAgents))
		for i, sa := range st.SubAgents {
			cp := sa
			cp.Tools = make(map[string]int, len(sa.Tools))
			for tk, tv := range sa.Tools {
				cp.Tools[tk] = tv
			}
			out.SubAgents[i] = cp
		}
	}
	return out
}

// TopTools returns the top N tool names by call count.
func (st *TicketStats) TopTools(n int) []ToolCount {
	out := make([]ToolCount, 0, len(st.Tools))
	for name, count := range st.Tools {
		out = append(out, ToolCount{Name: name, Count: count})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Count > out[j].Count })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

type ToolCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func mapFromEntry(e *transcriptEntry) map[string]any {
	// Round-trip through json so we can get fields not in the
	// struct (aiTitle / agentName / lastPrompt / etc.).
	b, _ := json.Marshal(e)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Trim multibyte boundary safely
	for n > 0 && (s[n]&0xC0) == 0x80 {
		n--
	}
	return s[:n] + "…"
}

// stripImages walks content and drops base64 image data so logged
// transcripts don't carry MB of binary in memory.
func stripImages(content []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(content))
	for _, c := range content {
		if c["type"] == "image" {
			c = map[string]any{"type": "image", "source": map[string]any{"type": "elided"}}
		}
		out = append(out, c)
	}
	return out
}

// helper exported for tests
func transcriptDirFor(worktree string) string {
	abs, _ := filepath.Abs(worktree)
	return filepath.Join(os.Getenv("HOME"), ".claude", "projects", sanitizeProjectDir(abs))
}
