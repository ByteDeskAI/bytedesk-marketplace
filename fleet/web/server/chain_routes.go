package main

// Chain HTTP routes — Phase 12.4 (BDM-28).
//
//   GET    /api/chains                        list[Chain]
//   GET    /api/chains/<id>                   Chain (single)
//   PUT    /api/chains/<id>                   save (body = Chain)
//   POST   /api/chains/<id>/run               kick off a run, returns 202 + {run_id}
//   GET    /api/chains/<id>/runs              list[ChainRunStatus] newest-first
//   GET    /api/chains/<id>/runs/<runID>      one ChainRunStatus
//   DELETE /api/chains/<id>                   delete the chain (and its runs)

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

func handleChainsCollection(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	switch r.Method {
	case http.MethodGet:
		cs, err := deps.chains.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, cs)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only on /api/chains; use /api/chains/<id> for write"))
	}
}

func handleChainItem(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/chains/")
	if rest == "" {
		writeError(w, http.StatusBadRequest, errors.New("expected /api/chains/<id>"))
		return
	}
	parts := strings.Split(rest, "/")
	id := parts[0]
	if !validChainID(id) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid chain id %q", id))
		return
	}
	// Sub-paths.
	if len(parts) >= 2 {
		switch parts[1] {
		case "run":
			handleChainRun(w, r, deps, id)
			return
		case "runs":
			if len(parts) == 2 {
				handleChainRunsList(w, r, deps, id)
				return
			}
			handleChainRunDetail(w, r, deps, id, parts[2])
			return
		default:
			writeError(w, http.StatusBadRequest, fmt.Errorf("unknown sub-path %q", parts[1]))
			return
		}
	}
	// /api/chains/<id> — GET / PUT / DELETE.
	switch r.Method {
	case http.MethodGet:
		c, err := deps.chains.Get(id)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				writeError(w, http.StatusNotFound, fmt.Errorf("chain %q not found", id))
				return
			}
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, c)
	case http.MethodPut:
		var c Chain
		if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
			return
		}
		// Path id wins over body id so the URL is canonical.
		c.ID = id
		if strings.TrimSpace(c.Name) == "" {
			c.Name = id
		}
		if err := deps.chains.Save(c); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		// Notify the bus that the chains list changed.
		if deps.bus != nil {
			deps.bus.Publish(Message{Topic: Topic("chains"), Body: map[string]interface{}{"kind": "saved", "chain_id": id}})
		}
		writeJSON(w, http.StatusOK, c)
	case http.MethodDelete:
		if err := deps.chains.Delete(id); err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		if deps.bus != nil {
			deps.bus.Publish(Message{Topic: Topic("chains"), Body: map[string]interface{}{"kind": "deleted", "chain_id": id}})
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET, PUT, DELETE"))
	}
}

func handleChainRun(w http.ResponseWriter, r *http.Request, deps *apiDeps, id string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	chain, err := deps.chains.Get(id)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, http.StatusNotFound, fmt.Errorf("chain %q not found", id))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	// The web dashboard runs at depth 0; mark the chain trusted so the
	// Script node can execute. Children spawned via the chain inherit
	// auth from the spawn-claude-feature env (CLAUDE_SESSION_DEPTH).
	chain.Trusted = true

	d := newChainRunDeps(deps)
	runID := fmt.Sprintf("%d", nowNano())

	// Seed an initial "running" state so polling immediately after the
	// 202 finds something on disk. The real RunChain will overwrite it
	// at the same path (same RunID).
	seed := &ChainRunStatus{
		RunID:   runID,
		ChainID: chain.ID,
		Started: time.Now().UTC(),
		State:   "running",
		Nodes:   map[string]ChainNodeRunState{},
		Trusted: true,
	}
	for _, n := range chain.Nodes {
		seed.Nodes[n.ID] = ChainNodeRunState{NodeID: n.ID, Type: n.Type, Status: "pending"}
	}
	flushRun(d, seed)

	go func(c Chain, rid string) {
		ctx := context.Background()
		_, _ = RunChain(ctx, d, c, rid)
	}(chain, runID)

	w.Header().Set("Location", fmt.Sprintf("/api/chains/%s/runs/%s", id, runID))
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "run_id": runID, "chain_id": id})
}

func handleChainRunsList(w http.ResponseWriter, r *http.Request, deps *apiDeps, id string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET required"))
		return
	}
	runs, err := listRuns(deps.chains, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, runs)
}

func handleChainRunDetail(w http.ResponseWriter, r *http.Request, deps *apiDeps, id, runID string) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET required"))
		return
	}
	run, err := loadRun(deps.chains, id, runID)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, http.StatusNotFound, fmt.Errorf("run %q not found", runID))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// nowNano is a tiny seam for tests to override the run-id source.
var nowNano = func() int64 { return time.Now().UnixNano() }
