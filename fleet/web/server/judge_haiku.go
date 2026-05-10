package main

// Phase 12.9 (BDM-?): Haiku-backed JudgeProvider.
//
// Architecture:
//   Go server  ──spawn──>  node index.mjs  (judge-sidecar)
//          \─── stdin: NDJSON requests   {id, op, payload}
//          /─── stdout: NDJSON responses {id, ok, result|error}
//
// One long-running sidecar per server. Per-request 5s timeout; on timeout,
// sidecar death, or any error, the caller falls back to a heuristic
// JudgeProvider that was injected at construction time. Verdicts are
// memoised in a tiny in-process LRU keyed by SHA-256 of the canonical
// request payload (TTL = 60s) so the per-request /api/sessions hot path
// doesn't pay a Haiku round-trip per row.
//
// Stdlib only — no extra Go deps.

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Wire shapes (must match judge-sidecar/index.mjs).

type haikuRequest struct {
	ID      string `json:"id"`
	Op      string `json:"op"`
	Payload any    `json:"payload,omitempty"`
}

type haikuResponse struct {
	ID     string          `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// ---------------------------------------------------------------------------
// Tiny TTL+LRU cache. We deliberately avoid pulling in a dep here; ~50 lines
// is cheaper than the supply-chain surface.

type cacheEntry struct {
	expires time.Time
	value   json.RawMessage
}

type ttlLRU struct {
	mu      sync.Mutex
	cap     int
	ttl     time.Duration
	entries map[string]cacheEntry
	order   []string // ring of insertion order; oldest first
}

func newTTLLRU(capacity int, ttl time.Duration) *ttlLRU {
	if capacity <= 0 {
		capacity = 256
	}
	return &ttlLRU{
		cap:     capacity,
		ttl:     ttl,
		entries: make(map[string]cacheEntry, capacity),
		order:   make([]string, 0, capacity),
	}
}

func (c *ttlLRU) get(key string) (json.RawMessage, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(e.expires) {
		delete(c.entries, key)
		// Lazy: leave the ring slot to be evicted on next put.
		return nil, false
	}
	return e.value, true
}

func (c *ttlLRU) put(key string, value json.RawMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.entries[key]; !exists {
		if len(c.entries) >= c.cap {
			// Evict oldest still-present key.
			for len(c.order) > 0 {
				oldest := c.order[0]
				c.order = c.order[1:]
				if _, ok := c.entries[oldest]; ok {
					delete(c.entries, oldest)
					break
				}
			}
		}
		c.order = append(c.order, key)
	}
	c.entries[key] = cacheEntry{
		expires: time.Now().Add(c.ttl),
		value:   value,
	}
}

// ---------------------------------------------------------------------------
// Provider.

// HaikuJudgeProvider proxies the JudgeProvider interface to a Node sidecar
// running @anthropic-ai/claude-agent-sdk. All public methods fall back to
// `fallback` on any error so callers see seamless degradation.
type HaikuJudgeProvider struct {
	fallback JudgeProvider

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser

	writeMu sync.Mutex // serialises writes to stdin

	pendingMu sync.Mutex
	pending   map[string]chan haikuResponse

	cache *ttlLRU

	closeOnce sync.Once
	closed    chan struct{}

	requestTimeout time.Duration
}

// haikuLocateSidecar resolves the sidecar working directory.
//
// Resolution order:
//  1. FLEET_JUDGE_SIDECAR_DIR env override.
//  2. ${CLAUDE_PLUGIN_ROOT}/web/server/judge-sidecar  (installed plugin path)
//  3. Source-tree-relative path next to this binary.
func haikuLocateSidecar() (string, error) {
	if v := os.Getenv("FLEET_JUDGE_SIDECAR_DIR"); v != "" {
		if _, err := os.Stat(filepath.Join(v, "index.mjs")); err == nil {
			return v, nil
		}
		return "", fmt.Errorf("FLEET_JUDGE_SIDECAR_DIR set but %s/index.mjs missing", v)
	}
	if root := os.Getenv("CLAUDE_PLUGIN_ROOT"); root != "" {
		p := filepath.Join(root, "web", "server", "judge-sidecar")
		if _, err := os.Stat(filepath.Join(p, "index.mjs")); err == nil {
			return p, nil
		}
	}
	// Source-tree fallback (running `go run` or a freshly-built binary).
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 5; i++ {
			cand := filepath.Join(dir, "judge-sidecar")
			if _, err := os.Stat(filepath.Join(cand, "index.mjs")); err == nil {
				return cand, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if wd, err := os.Getwd(); err == nil {
		cand := filepath.Join(wd, "judge-sidecar")
		if _, err := os.Stat(filepath.Join(cand, "index.mjs")); err == nil {
			return cand, nil
		}
	}
	return "", errors.New("judge-sidecar directory not found")
}

// NewHaikuJudgeProvider spawns the sidecar, performs a 5s health-check
// (`{op:"ping"}`) and returns a ready-to-use provider. `fallback` is what
// will be used for any per-request error (timeout, decode failure,
// sidecar death). It must not be nil.
func NewHaikuJudgeProvider(fallback JudgeProvider) (*HaikuJudgeProvider, error) {
	if fallback == nil {
		return nil, errors.New("haiku judge: fallback provider required")
	}
	dir, err := haikuLocateSidecar()
	if err != nil {
		return nil, err
	}
	if _, err := exec.LookPath("node"); err != nil {
		return nil, fmt.Errorf("haiku judge: node not on PATH: %w", err)
	}

	timeout := 5 * time.Second
	if v := os.Getenv("FLEET_JUDGE_TIMEOUT_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			timeout = time.Duration(ms) * time.Millisecond
		}
	}

	cmd := exec.Command("node", "index.mjs")
	cmd.Dir = dir
	cmd.Env = os.Environ()
	cmd.Stderr = os.Stderr // surface sidecar errors to the server log

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("haiku judge: stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, fmt.Errorf("haiku judge: stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("haiku judge: start node: %w", err)
	}

	p := &HaikuJudgeProvider{
		fallback:       fallback,
		cmd:            cmd,
		stdin:          stdin,
		stdout:         stdout,
		pending:        make(map[string]chan haikuResponse),
		cache:          newTTLLRU(256, 60*time.Second),
		closed:         make(chan struct{}),
		requestTimeout: timeout,
	}

	go p.readLoop()
	go p.waitLoop()

	// Health-check.
	hctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if _, err := p.call(hctx, "ping", nil, false); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("haiku judge: health-check failed: %w", err)
	}
	return p, nil
}

// readLoop pumps lines from sidecar stdout and dispatches them to the
// matching pending channel by id.
func (p *HaikuJudgeProvider) readLoop() {
	scanner := bufio.NewScanner(p.stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var resp haikuResponse
		if err := json.Unmarshal(line, &resp); err != nil {
			log.Printf("haiku judge: bad sidecar line: %v", err)
			continue
		}
		p.pendingMu.Lock()
		ch, ok := p.pending[resp.ID]
		if ok {
			delete(p.pending, resp.ID)
		}
		p.pendingMu.Unlock()
		if ok {
			// Non-blocking send: the consumer may have already given up.
			select {
			case ch <- resp:
			default:
			}
		}
	}
	// Stdout closed → sidecar dead. Flush all waiters.
	p.markClosed(errors.New("sidecar stdout closed"))
}

// waitLoop reaps the subprocess and triggers Close() bookkeeping when it
// exits unexpectedly.
func (p *HaikuJudgeProvider) waitLoop() {
	if p.cmd == nil {
		return
	}
	_ = p.cmd.Wait()
	p.markClosed(errors.New("sidecar process exited"))
}

func (p *HaikuJudgeProvider) markClosed(reason error) {
	p.closeOnce.Do(func() {
		close(p.closed)
		p.pendingMu.Lock()
		for id, ch := range p.pending {
			delete(p.pending, id)
			select {
			case ch <- haikuResponse{ID: id, OK: false, Error: reason.Error()}:
			default:
			}
		}
		p.pendingMu.Unlock()
	})
}

// Close terminates the sidecar process and releases pipes. Safe to call
// multiple times.
func (p *HaikuJudgeProvider) Close() error {
	p.markClosed(errors.New("provider closed"))
	if p.stdin != nil {
		_ = p.stdin.Close()
	}
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
	return nil
}

// call sends a single request, waits up to requestTimeout for a response,
// and returns the unmarshaled `result` field. `useCache=true` consults the
// LRU first (and stores the result on success); ping requests bypass it.
func (p *HaikuJudgeProvider) call(ctx context.Context, op string, payload any, useCache bool) (json.RawMessage, error) {
	select {
	case <-p.closed:
		return nil, errors.New("sidecar closed")
	default:
	}

	var cacheKey string
	if useCache {
		cacheKey = haikuCacheKey(op, payload)
		if v, ok := p.cache.get(cacheKey); ok {
			return v, nil
		}
	}

	id := haikuNewID()
	req := haikuRequest{ID: id, Op: op, Payload: payload}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	ch := make(chan haikuResponse, 1)
	p.pendingMu.Lock()
	p.pending[id] = ch
	p.pendingMu.Unlock()
	defer func() {
		p.pendingMu.Lock()
		delete(p.pending, id)
		p.pendingMu.Unlock()
	}()

	p.writeMu.Lock()
	_, werr := p.stdin.Write(append(body, '\n'))
	p.writeMu.Unlock()
	if werr != nil {
		return nil, fmt.Errorf("write request: %w", werr)
	}

	select {
	case resp := <-ch:
		if !resp.OK {
			return nil, fmt.Errorf("sidecar error: %s", resp.Error)
		}
		if useCache && cacheKey != "" {
			p.cache.put(cacheKey, resp.Result)
		}
		return resp.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-p.closed:
		return nil, errors.New("sidecar closed mid-request")
	}
}

// haikuNewID returns a short opaque id. We don't need RFC4122 — uniqueness
// across pending in-flight requests is sufficient.
var haikuIDCounter uint64
var haikuIDMu sync.Mutex

func haikuNewID() string {
	haikuIDMu.Lock()
	haikuIDCounter++
	n := haikuIDCounter
	haikuIDMu.Unlock()
	return fmt.Sprintf("%d-%d", time.Now().UnixNano(), n)
}

// haikuCacheKey returns a stable hash of (op, payload) for cache lookup.
func haikuCacheKey(op string, payload any) string {
	body, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	h := sha256.New()
	h.Write([]byte(op))
	h.Write([]byte{0})
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// ---------------------------------------------------------------------------
// JudgeProvider impl. Each method tries the sidecar; any error logs once
// and falls back to the heuristic provider.

type judgeStatePayload struct {
	Prompt  string `json:"prompt"`
	LogTail string `json:"logTail"`
}

type judgeStateResult struct {
	State      string  `json:"state"`
	Confidence float64 `json:"confidence"`
	Objective  string  `json:"objective"`
}

func (p *HaikuJudgeProvider) JudgeState(s Session, logTail string) (string, float64, string) {
	ctx, cancel := context.WithTimeout(context.Background(), p.requestTimeout)
	defer cancel()
	prompt := haikuReadPrompt(s.PromptFile)
	raw, err := p.call(ctx, "judge_state", judgeStatePayload{Prompt: prompt, LogTail: logTail}, true)
	if err != nil {
		haikuLogFallback("judge_state", err)
		return p.fallback.JudgeState(s, logTail)
	}
	var r judgeStateResult
	if err := json.Unmarshal(raw, &r); err != nil {
		haikuLogFallback("judge_state decode", err)
		return p.fallback.JudgeState(s, logTail)
	}
	if r.State == "" {
		return p.fallback.JudgeState(s, logTail)
	}
	if r.Confidence < 0 {
		r.Confidence = 0
	}
	if r.Confidence > 1 {
		r.Confidence = 1
	}
	return r.State, r.Confidence, r.Objective
}

type driftResult struct {
	Drift float64 `json:"drift"`
}

func (p *HaikuJudgeProvider) DriftScore(s Session, logTail string) float64 {
	ctx, cancel := context.WithTimeout(context.Background(), p.requestTimeout)
	defer cancel()
	prompt := haikuReadPrompt(s.PromptFile)
	raw, err := p.call(ctx, "drift", judgeStatePayload{Prompt: prompt, LogTail: logTail}, true)
	if err != nil {
		haikuLogFallback("drift", err)
		return p.fallback.DriftScore(s, logTail)
	}
	var r driftResult
	if err := json.Unmarshal(raw, &r); err != nil {
		haikuLogFallback("drift decode", err)
		return p.fallback.DriftScore(s, logTail)
	}
	if r.Drift < 0 {
		return 0
	}
	if r.Drift > 1 {
		return 1
	}
	return r.Drift
}

type estimateCostPayload struct {
	Prompt   string `json:"prompt"`
	FullAuto bool   `json:"fullAuto"`
}

type estimateCostResult struct {
	Low  float64 `json:"low"`
	High float64 `json:"high"`
}

func (p *HaikuJudgeProvider) EstimateCost(prompt string, fullAuto bool) (float64, float64) {
	ctx, cancel := context.WithTimeout(context.Background(), p.requestTimeout)
	defer cancel()
	raw, err := p.call(ctx, "estimate_cost", estimateCostPayload{Prompt: prompt, FullAuto: fullAuto}, true)
	if err != nil {
		haikuLogFallback("estimate_cost", err)
		return p.fallback.EstimateCost(prompt, fullAuto)
	}
	var r estimateCostResult
	if err := json.Unmarshal(raw, &r); err != nil {
		haikuLogFallback("estimate_cost decode", err)
		return p.fallback.EstimateCost(prompt, fullAuto)
	}
	if r.Low < 0 {
		r.Low = 0
	}
	if r.High < r.Low {
		r.High = r.Low
	}
	return r.Low, r.High
}

// haikuReadPrompt reads the per-session original prompt if available. Empty
// string is fine — the sidecar handles it.
func haikuReadPrompt(path string) string {
	if path == "" {
		return ""
	}
	const cap = 16 * 1024
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, cap)
	n, _ := f.Read(buf)
	return string(buf[:n])
}

// haikuLogFallback throttles fallback log spam to ~once per 30s per kind.
var (
	haikuLogMu     sync.Mutex
	haikuLogLastAt = make(map[string]time.Time)
)

func haikuLogFallback(kind string, err error) {
	haikuLogMu.Lock()
	defer haikuLogMu.Unlock()
	last, ok := haikuLogLastAt[kind]
	if ok && time.Since(last) < 30*time.Second {
		return
	}
	haikuLogLastAt[kind] = time.Now()
	log.Printf("haiku judge: %s falling back to heuristic: %v", kind, err)
}
