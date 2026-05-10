package main

// HTTP surface for the transcript stream cache.
//
//   GET /api/sessions/<T>/stats          → TicketStats JSON
//   GET /api/sessions/<T>/transcript     → SSE stream of TranscriptEvent
//                                          (typed events parsed live from
//                                           the .jsonl)
//   GET /api/sessions/<T>/messages       → UIMessage[] (chat-mode bootstrap)
//       ?agent_id=<id>   sub-agent thread
//       ?limit=<n>       cap (default 200)

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"time"
)

func handleSessionStats(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	st, ok := deps.transcript.Stats(ticket)
	if !ok {
		// No transcript yet — return an empty, well-formed shape.
		writeJSON(w, http.StatusOK, TicketStats{Ticket: ticket, Tools: map[string]int{}})
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func handleSessionTranscriptStream(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := deps.bus.Subscribe(Topic("transcript." + ticket))
	defer deps.bus.Unsubscribe(sub)

	// Send the current stats snapshot so the client has immediate state.
	if st, ok := deps.transcript.Stats(ticket); ok {
		b, _ := json.Marshal(st)
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", b)
		flusher.Flush()
	}

	keep := time.NewTicker(15 * time.Second)
	defer keep.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keep.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case msg, ok := <-sub.C():
			if !ok {
				return
			}
			b, _ := json.Marshal(msg.Body)
			fmt.Fprintf(w, "event: transcript\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}
}

// handleSessionMessages — chat-mode bootstrap. Returns up to `limit`
// (default 200) UIMessages from the parent transcript, or from a
// sub-agent transcript when `?agent_id=<id>` is provided. The client
// then attaches to the SSE feed for live deltas.
func handleSessionMessages(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	q := r.URL.Query()
	limit := 200
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
		return
	}
	var path string
	if agentID := q.Get("agent_id"); agentID != "" {
		// Find the matching subagent file.
		for _, f := range findSubAgentTranscripts(s.Worktree) {
			if f.AgentID == agentID {
				path = f.Path
				break
			}
		}
		if path == "" {
			// Last-resort: build the expected path so a 404 is informative.
			path = filepath.Join(transcriptDirFor(s.Worktree), "subagents", "agent-"+agentID+".jsonl")
		}
	} else {
		path = findTranscript(s.Worktree)
	}
	if path == "" {
		writeJSON(w, http.StatusOK, []UIMessage{})
		return
	}
	msgs, err := readUIMessages(path, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if msgs == nil {
		msgs = []UIMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}
