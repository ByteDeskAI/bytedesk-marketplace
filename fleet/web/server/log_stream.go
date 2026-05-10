package main

// Per-session log streaming. Two surfaces:
//
//   GET  /api/sessions/<TICKET>/log   — current log content (tail, ?bytes=N)
//   GET  /api/sessions/<TICKET>/stream — chunked text stream of new log
//                                        appendages (Server-Sent Events
//                                        format for browser EventSource)
//
// Phase 4 uses the existing tee'd log file as the source of truth (the
// CLI already pipe-panes tmux output there), so we don't need direct
// tmux integration yet. Phase 5 adds POST /api/sessions/<TICKET>/send
// for input.

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

func handleSessionLog(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	bytes := int64(64 * 1024)
	if v := r.URL.Query().Get("bytes"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			bytes = n
		}
	}
	logPath := filepath.Join(deps.sessionsRoot(), ticket, "log")
	f, err := os.Open(logPath)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			http.Error(w, "no log yet", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	off := int64(0)
	if info.Size() > bytes {
		off = info.Size() - bytes
	}
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	if _, err := io.Copy(w, f); err != nil {
		// client disconnect or similar; nothing to do
		return
	}
}

func handleSessionStream(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	logPath := filepath.Join(deps.sessionsRoot(), ticket, "log")
	f, err := os.Open(logPath)
	if err != nil {
		// stream a single error event so client can show a status
		fmt.Fprintf(w, "event: error\ndata: %q\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer f.Close()

	// Send last 8KB on connect
	info, _ := f.Stat()
	off := int64(0)
	if info != nil && info.Size() > 8192 {
		off = info.Size() - 8192
	}
	if _, err := f.Seek(off, io.SeekStart); err == nil {
		buf := make([]byte, 8192)
		n, _ := f.Read(buf)
		if n > 0 {
			fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", encodeMultiline(buf[:n]))
			flusher.Flush()
		}
	}

	// Tail: poll for size changes; stream new bytes.
	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()
	poll := time.NewTicker(500 * time.Millisecond)
	defer poll.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case <-poll.C:
			info, err := f.Stat()
			if err != nil {
				continue
			}
			cur, _ := f.Seek(0, io.SeekCurrent)
			if info.Size() > cur {
				buf := make([]byte, info.Size()-cur)
				n, _ := f.Read(buf)
				if n > 0 {
					fmt.Fprintf(w, "event: append\ndata: %s\n\n", encodeMultiline(buf[:n]))
					flusher.Flush()
				}
			} else if info.Size() < cur {
				// log truncated/rotated; reset
				_, _ = f.Seek(0, io.SeekStart)
			}
		}
	}
}

// encodeMultiline escapes newlines and carriage returns so they survive
// the SSE `data:` field (which is line-terminated). Client unescapes.
func encodeMultiline(b []byte) string {
	out := make([]byte, 0, len(b)+16)
	for _, c := range b {
		switch c {
		case '\n':
			out = append(out, '\\', 'n')
		case '\r':
			out = append(out, '\\', 'r')
		case '\\':
			out = append(out, '\\', '\\')
		default:
			out = append(out, c)
		}
	}
	return string(out)
}
