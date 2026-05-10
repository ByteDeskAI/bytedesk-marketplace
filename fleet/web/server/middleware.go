package main

// Phase 12.6 (BDM-28, C6). Decorator chain wrapping every /api/* mux
// handler. Order: RequestID → Log → Auth → handler.
//
// Auth strategy: if cfg.AuthToken == "" → no auth (default).
// Otherwise require either:
//   Authorization: Bearer <token>   (preferred)
//   ?token=<token>                  (fallback for EventSource / WebSocket
//                                    where headers can't be set easily)
// Failed auth → 401 with JSON {"error": "..."}.
//
// /healthz, /api/version, and the static SPA at / are NOT gated so a
// browser without a token can still load the page and prompt for one.

import (
	"crypto/subtle"
	"log"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

var requestSeq uint64

type middleware func(http.Handler) http.Handler

// chain composes middlewares right-to-left so the outermost-listed runs
// first.
func chain(h http.Handler, mw ...middleware) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}

func requestIDMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := atomic.AddUint64(&requestSeq, 1)
		w.Header().Set("X-Request-ID", "r-"+itoa(int(id)))
		next.ServeHTTP(w, r)
	})
}

func logMW(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// Cheap status-code capture via a wrapper.
		sw := &statusWriter{ResponseWriter: w, status: 200}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s -> %d %s", r.Method, r.URL.Path, sw.status, time.Since(start))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// authMW builds the auth middleware bound to a token. If token is "",
// the middleware is a passthrough.
func authMW(token string) middleware {
	if token == "" {
		return func(h http.Handler) http.Handler { return h }
	}
	expected := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			provided := ""
			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				provided = strings.TrimPrefix(h, "Bearer ")
			}
			if provided == "" {
				provided = r.URL.Query().Get("token")
			}
			if provided == "" || subtle.ConstantTimeCompare([]byte(provided), expected) != 1 {
				writeError(w, http.StatusUnauthorized, errAuthRequired)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// errAuthRequired — sentinel returned by the middleware so callers can
// match on it.
var errAuthRequired = &authErr{}

type authErr struct{}

func (*authErr) Error() string { return "authorization required (Bearer token or ?token=)" }
