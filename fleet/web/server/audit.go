package main

// Phase 12.7 (BDM-28, B13). Tamper-evident hash chain over per-session
// events.jsonl. For each ticket we maintain a sidecar `events.hashlog`
// file with one line per event:
//
//   <line_no> <prev_hash> <hash>
//
// where prev_hash is the previous line's hash (or 0 for line 0) and
// hash = sha256( prev_hash || canonical-event-bytes ).
//
// On verify: re-hash each event line and compare with the recorded
// hash. The first divergence is reported. The verifier walks the chain
// in append-only order; any out-of-order rewrite of events.jsonl
// produces a mismatch.
//
//   GET /api/audit/verify?ticket=<T>     verify one session
//   GET /api/audit/verify                verify every session
//
// The hash chain is built lazily on read — events.hashlog is rebuilt
// from scratch each verify call. This keeps the in-band events writer
// path (PostToolUse hook) untouched. Future work: tail events.jsonl
// from the dashboard server and append to events.hashlog so verify
// becomes O(tail-length) instead of O(file).

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type auditResult struct {
	Ticket   string `json:"ticket"`
	OK       bool   `json:"ok"`
	Lines    int    `json:"lines"`
	BadLine  int    `json:"bad_line,omitempty"` // 1-based
	BadHash  string `json:"bad_hash,omitempty"`
	WantHash string `json:"want_hash,omitempty"`
	Reason   string `json:"reason,omitempty"`
	HeadHash string `json:"head_hash,omitempty"`
}

func handleAuditVerify(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	one := r.URL.Query().Get("ticket")
	root := deps.sessionsRoot()

	if one != "" {
		writeJSON(w, http.StatusOK, verifyTicket(root, one))
		return
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	out := []auditResult{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		out = append(out, verifyTicket(root, e.Name()))
	}
	writeJSON(w, http.StatusOK, out)
}

func verifyTicket(root, ticket string) auditResult {
	res := auditResult{Ticket: ticket, OK: true}
	events := filepath.Join(root, ticket, "events")
	hashlog := filepath.Join(root, ticket, "events.hashlog")

	ef, err := os.Open(events)
	if err != nil {
		// no events at all → trivially OK
		if os.IsNotExist(err) {
			return res
		}
		res.OK = false
		res.Reason = err.Error()
		return res
	}
	defer ef.Close()
	scanner := bufio.NewScanner(ef)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	prev := strings.Repeat("0", 64)
	var recorded []string
	if data, err := os.ReadFile(hashlog); err == nil {
		for _, ln := range strings.Split(strings.TrimRight(string(data), "\n"), "\n") {
			parts := strings.Fields(ln)
			if len(parts) >= 3 {
				recorded = append(recorded, parts[2])
			}
		}
	}

	lineNo := 0
	for scanner.Scan() {
		lineNo++
		raw := scanner.Bytes()
		h := sha256.New()
		h.Write([]byte(prev))
		h.Write(raw)
		got := hex.EncodeToString(h.Sum(nil))

		if lineNo-1 < len(recorded) {
			want := recorded[lineNo-1]
			if !strings.EqualFold(want, got) {
				res.OK = false
				res.BadLine = lineNo
				res.BadHash = got
				res.WantHash = want
				res.Reason = "hash mismatch — events file diverges from hashlog"
				res.Lines = lineNo
				return res
			}
		}
		prev = got
		res.Lines = lineNo
	}
	res.HeadHash = prev

	// Reconcile: if the events file has more lines than the hashlog,
	// extend the hashlog (best-effort; we don't fail verify if write
	// errors).
	if len(recorded) < res.Lines {
		// Re-walk to compute and append. Re-open since the previous
		// scanner is exhausted.
		_ = appendHashlog(events, hashlog, recorded)
	}
	return res
}

func appendHashlog(events, hashlog string, recorded []string) error {
	f, err := os.Open(events)
	if err != nil {
		return err
	}
	defer f.Close()
	out, err := os.OpenFile(hashlog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()

	prev := strings.Repeat("0", 64)
	if len(recorded) > 0 {
		prev = recorded[len(recorded)-1]
	}
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		if lineNo <= len(recorded) {
			// already covered
			h := sha256.New()
			h.Write([]byte(prev))
			h.Write(scanner.Bytes())
			prev = hex.EncodeToString(h.Sum(nil))
			continue
		}
		h := sha256.New()
		h.Write([]byte(prev))
		h.Write(scanner.Bytes())
		got := hex.EncodeToString(h.Sum(nil))
		// "<line_no> <prev_hash> <hash>"
		_, _ = out.WriteString(itoaSimple(lineNo))
		_, _ = out.WriteString(" ")
		_, _ = out.WriteString(prev)
		_, _ = out.WriteString(" ")
		_, _ = out.WriteString(got)
		_, _ = out.WriteString("\n")
		prev = got
	}
	return nil
}

func itoaSimple(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for n > 0 {
		pos--
		b[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(b[pos:])
}
