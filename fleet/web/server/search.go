package main

// Phase 12.5 (BDM-28, C1). Full-text search across all session logs.
// Walks ${PLUGIN_DATA}/projects/<KEY>/sessions/*/log with bufio.Scanner
// for predictable memory; returns matches as {ticket, line_no, line}
// with one line of context above/below.
//
//   GET /api/search?q=<term>&limit=200&case=0|1
//
// q is matched as a literal substring (no regex) for safety.

import (
	"bufio"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type searchHit struct {
	Ticket string `json:"ticket"`
	LineNo int    `json:"line_no"`
	Line   string `json:"line"`
	Before string `json:"before,omitempty"`
	After  string `json:"after,omitempty"`
}

func handleSearch(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	q := r.URL.Query().Get("q")
	if q == "" {
		writeJSON(w, http.StatusOK, []searchHit{})
		return
	}
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	caseInsensitive := r.URL.Query().Get("case") != "1"
	needle := q
	if caseInsensitive {
		needle = strings.ToLower(q)
	}

	root := deps.sessionsRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	out := []searchHit{}
outer:
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		ticket := e.Name()
		path := filepath.Join(root, ticket, "log")
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		// scan with a generous buffer for long output lines.
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)

		var prev string
		var pendingAfter int
		var pendingHit *searchHit
		lineNo := 0
		for sc.Scan() {
			lineNo++
			line := sc.Text()
			cmp := line
			if caseInsensitive {
				cmp = strings.ToLower(line)
			}
			// flush "after" context for the previous hit
			if pendingAfter > 0 {
				if pendingHit != nil {
					if pendingHit.After == "" {
						pendingHit.After = line
					}
					pendingAfter--
					if pendingAfter == 0 {
						out = append(out, *pendingHit)
						pendingHit = nil
						if len(out) >= limit {
							f.Close()
							break outer
						}
					}
				}
			}
			if strings.Contains(cmp, needle) {
				h := searchHit{Ticket: ticket, LineNo: lineNo, Line: line, Before: prev}
				pendingHit = &h
				pendingAfter = 1
			}
			prev = line
		}
		if pendingHit != nil {
			out = append(out, *pendingHit)
			if len(out) >= limit {
				f.Close()
				break outer
			}
		}
		f.Close()
	}
	writeJSON(w, http.StatusOK, out)
}
