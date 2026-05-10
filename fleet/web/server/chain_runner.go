package main

// ChainRunner — Phase 12.4 (BDM-28). Walks a persisted Chain DAG in
// topological order, dispatches each node by type, and persists the
// run state under <chains-dir>/<id>.runs/<runID>.json so the dashboard
// can render history.
//
// Node dispatch:
//
//   spawn     → builds a SpawnRequest from node.Config (ticket, slug,
//               prompt, full_auto, parent, max_depth) and shells out
//               via spawn-claude-feature, mirroring handleSpawn.
//   wait      → polls the SessionRepo until session.State matches the
//               requested state (or a timeout — default 10min).
//   judge     → pass-through stub. TODO Haiku judge wiring lands in
//               Phase 12.9 (BDM-28 / B11).
//   condition → evaluates a tiny equality expression against prior
//               node outputs ("${node-id.state} == \"done\""). Picks
//               OnSuccess vs OnFailure outgoing edges accordingly.
//   notify    → POSTs a message via the existing /api/broadcast hook
//               (in-process, no HTTP roundtrip — calls the same code
//               path).
//   script    → bash -c on node.Config["cmd"]. Gated on chain.Trusted.
//
// Variable substitution: any string in node.Config can reference
// `${<node-id>.ticket}` or `${<node-id>.state}` from a previously-run
// node — the runner expands these before dispatch.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ChainRunStatus is the persisted shape for one chain execution.
type ChainRunStatus struct {
	RunID    string                       `json:"run_id"`
	ChainID  string                       `json:"chain_id"`
	Started  time.Time                    `json:"started"`
	Finished time.Time                    `json:"finished,omitempty"`
	State    string                       `json:"state"` // running|done|error
	Error    string                       `json:"error,omitempty"`
	Nodes    map[string]ChainNodeRunState `json:"nodes"`
	Trusted  bool                         `json:"trusted"`
}

// ChainNodeRunState captures one node's outcome inside a run. The
// Outputs map is what condition / spawn-downstream nodes read from
// when expanding ${node-id.X} variables.
type ChainNodeRunState struct {
	NodeID   string                 `json:"node_id"`
	Type     string                 `json:"type"`
	Status   string                 `json:"status"` // pending|running|done|error|skipped
	Started  time.Time              `json:"started,omitempty"`
	Finished time.Time              `json:"finished,omitempty"`
	Error    string                 `json:"error,omitempty"`
	Outputs  map[string]interface{} `json:"outputs,omitempty"`
}

// ChainRunDeps narrows what the runner needs from apiDeps so tests can
// stub it without spinning up the full server.
type ChainRunDeps struct {
	Sessions    *SessionRepo
	Bus         *EventBus
	ChainsRepo  *ChainsRepo
	WaitTimeout time.Duration // default 10min
	PollEvery   time.Duration // default 2s
}

func newChainRunDeps(deps *apiDeps) *ChainRunDeps {
	return &ChainRunDeps{
		Sessions:    deps.sessions,
		Bus:         deps.bus,
		ChainsRepo:  deps.chains,
		WaitTimeout: 10 * time.Minute,
		PollEvery:   2 * time.Second,
	}
}

// RunChain orchestrates the chain. Synchronous; the route handler
// invokes it inside a goroutine so the HTTP request returns 202
// immediately. State is flushed to disk + published on the bus on
// every node transition. If runID is non-empty it's used verbatim;
// otherwise a nanosecond-precision id is generated.
func RunChain(ctx context.Context, d *ChainRunDeps, chain Chain, runID string) (*ChainRunStatus, error) {
	if d == nil || d.ChainsRepo == nil {
		return nil, errors.New("ChainRunDeps requires a ChainsRepo")
	}
	if d.WaitTimeout == 0 {
		d.WaitTimeout = 10 * time.Minute
	}
	if d.PollEvery == 0 {
		d.PollEvery = 2 * time.Second
	}

	order, err := topoSort(chain)
	if err != nil {
		return nil, err
	}

	if runID == "" {
		runID = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	run := &ChainRunStatus{
		RunID:   runID,
		ChainID: chain.ID,
		Started: time.Now().UTC(),
		State:   "running",
		Nodes:   map[string]ChainNodeRunState{},
		Trusted: chain.Trusted,
	}
	for _, n := range chain.Nodes {
		run.Nodes[n.ID] = ChainNodeRunState{NodeID: n.ID, Type: n.Type, Status: "pending"}
	}
	flushRun(d, run)

	skip := map[string]bool{}
	for _, nodeID := range order {
		select {
		case <-ctx.Done():
			run.State = "error"
			run.Error = ctx.Err().Error()
			run.Finished = time.Now().UTC()
			flushRun(d, run)
			return run, ctx.Err()
		default:
		}
		if skip[nodeID] {
			st := run.Nodes[nodeID]
			st.Status = "skipped"
			run.Nodes[nodeID] = st
			flushRun(d, run)
			continue
		}
		node := findNode(chain, nodeID)
		if node == nil {
			continue
		}
		st := run.Nodes[nodeID]
		st.Status = "running"
		st.Started = time.Now().UTC()
		run.Nodes[nodeID] = st
		flushRun(d, run)

		outputs, runErr := dispatchNode(ctx, d, *node, chain, run)
		st = run.Nodes[nodeID]
		st.Finished = time.Now().UTC()
		st.Outputs = outputs
		if runErr != nil {
			st.Status = "error"
			st.Error = runErr.Error()
			run.Nodes[nodeID] = st
			// If this is a condition node, the err might be intentional —
			// we still propagate skip via OnFailure edges below.
			if node.Type != "condition" {
				run.State = "error"
				run.Error = fmt.Sprintf("node %q: %s", node.ID, runErr.Error())
				run.Finished = time.Now().UTC()
				flushRun(d, run)
				return run, runErr
			}
		} else {
			st.Status = "done"
			run.Nodes[nodeID] = st
		}
		flushRun(d, run)

		// Branch: condition nodes select OnSuccess vs OnFailure edges.
		if node.Type == "condition" {
			passed := runErr == nil
			for _, e := range chain.Edges {
				if e.From != node.ID {
					continue
				}
				switch {
				case e.OnSuccess && !passed:
					markSubtreeSkipped(chain, e.To, skip)
				case e.OnFailure && passed:
					markSubtreeSkipped(chain, e.To, skip)
				}
			}
		}
	}

	run.State = "done"
	run.Finished = time.Now().UTC()
	flushRun(d, run)
	return run, nil
}

func dispatchNode(ctx context.Context, d *ChainRunDeps, node ChainNode, chain Chain, run *ChainRunStatus) (map[string]interface{}, error) {
	cfg := expandVars(node.Config, run)
	switch node.Type {
	case "spawn":
		return runSpawnNode(cfg)
	case "wait":
		return runWaitNode(ctx, d, cfg)
	case "judge":
		return runJudgeNode(cfg)
	case "condition":
		return runConditionNode(cfg)
	case "notify":
		return runNotifyNode(d, cfg)
	case "script":
		return runScriptNode(ctx, chain.Trusted, cfg)
	default:
		return nil, fmt.Errorf("unknown node type %q", node.Type)
	}
}

func runSpawnNode(cfg map[string]interface{}) (map[string]interface{}, error) {
	req := SpawnRequest{
		Ticket:   asString(cfg, "ticket"),
		Slug:     asString(cfg, "slug"),
		Prompt:   asString(cfg, "prompt"),
		FullAuto: asBool(cfg, "full_auto"),
		Parent:   asString(cfg, "parent"),
		MaxDepth: asInt(cfg, "max_depth"),
	}
	if err := req.validate(); err != nil {
		return nil, err
	}
	f, err := os.CreateTemp("", "fleet-chain-prompt-*.txt")
	if err != nil {
		return nil, fmt.Errorf("temp prompt: %w", err)
	}
	promptPath := f.Name()
	defer os.Remove(promptPath)
	if _, err := f.WriteString(req.Prompt); err != nil {
		f.Close()
		return nil, fmt.Errorf("write prompt: %w", err)
	}
	f.Close()

	cmd := exec.Command(spawnBin(), req.buildArgs(promptPath)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("spawn failed: %v: %s", err, string(out))
	}
	return map[string]interface{}{
		"ticket": req.Ticket,
		"slug":   req.Slug,
		"stdout": strings.TrimSpace(string(out)),
	}, nil
}

func runWaitNode(ctx context.Context, d *ChainRunDeps, cfg map[string]interface{}) (map[string]interface{}, error) {
	ticket := asString(cfg, "ticket")
	want := asString(cfg, "state")
	if ticket == "" {
		return nil, errors.New("wait: ticket required")
	}
	if want == "" {
		want = "done"
	}
	timeout := d.WaitTimeout
	if t := asInt(cfg, "timeout"); t > 0 {
		timeout = time.Duration(t) * time.Second
	}
	deadline := time.Now().Add(timeout)
	for {
		if d.Sessions != nil {
			s, err := d.Sessions.Get(ticket)
			if err == nil && s.State == want {
				return map[string]interface{}{"ticket": ticket, "state": s.State}, nil
			}
		}
		if time.Now().After(deadline) {
			return map[string]interface{}{"ticket": ticket}, fmt.Errorf("wait timed out after %s waiting for %s=%s", timeout, ticket, want)
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(d.PollEvery):
		}
	}
}

func runJudgeNode(cfg map[string]interface{}) (map[string]interface{}, error) {
	// TODO: Haiku judge wiring lands in Phase 12.9 (BDM-28 / B11).
	// Today: pass-through with a "passed" verdict so downstream nodes run.
	prompt := asString(cfg, "prompt")
	return map[string]interface{}{"verdict": "passed", "prompt": prompt, "stub": true}, nil
}

func runConditionNode(cfg map[string]interface{}) (map[string]interface{}, error) {
	expr := strings.TrimSpace(asString(cfg, "expr"))
	if expr == "" {
		return map[string]interface{}{"expr": "", "result": true}, nil
	}
	// Tiny expression: `<lhs> == <rhs>` or `<lhs> != <rhs>`. After
	// expandVars the lhs/rhs are concrete strings.
	op := "=="
	idx := strings.Index(expr, "==")
	if idx < 0 {
		idx = strings.Index(expr, "!=")
		if idx < 0 {
			return map[string]interface{}{"expr": expr, "result": false}, fmt.Errorf("condition expr missing == or !=")
		}
		op = "!="
	}
	lhs := strings.Trim(strings.TrimSpace(expr[:idx]), `"'`)
	rhs := strings.Trim(strings.TrimSpace(expr[idx+2:]), `"'`)
	result := lhs == rhs
	if op == "!=" {
		result = !result
	}
	out := map[string]interface{}{"expr": expr, "lhs": lhs, "rhs": rhs, "result": result}
	if !result {
		return out, fmt.Errorf("condition false: %s %s %s", lhs, op, rhs)
	}
	return out, nil
}

func runNotifyNode(d *ChainRunDeps, cfg map[string]interface{}) (map[string]interface{}, error) {
	msg := asString(cfg, "message")
	if msg == "" {
		return nil, errors.New("notify: message required")
	}
	if d.Bus != nil {
		d.Bus.Publish(Message{Topic: Topic("chains"), Body: map[string]interface{}{"kind": "notify", "message": msg}})
	}
	return map[string]interface{}{"message": msg}, nil
}

func runScriptNode(ctx context.Context, trusted bool, cfg map[string]interface{}) (map[string]interface{}, error) {
	cmdStr := asString(cfg, "cmd")
	if cmdStr == "" {
		return nil, errors.New("script: cmd required")
	}
	if !trusted {
		return nil, errors.New("script: chain is not trusted (must be run by depth-0 user)")
	}
	cmd := exec.CommandContext(ctx, "bash", "-c", cmdStr)
	out, err := cmd.CombinedOutput()
	res := map[string]interface{}{"cmd": cmdStr, "stdout": strings.TrimSpace(string(out))}
	if err != nil {
		return res, fmt.Errorf("script failed: %v: %s", err, string(out))
	}
	return res, nil
}

// expandVars walks a config map and substitutes `${<node-id>.<key>}`
// tokens with the matching output from a previously-completed node.
// Strings only — non-string values pass through.
var varPattern = regexp.MustCompile(`\$\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}`)

func expandVars(cfg map[string]interface{}, run *ChainRunStatus) map[string]interface{} {
	out := make(map[string]interface{}, len(cfg))
	for k, v := range cfg {
		if s, ok := v.(string); ok {
			out[k] = varPattern.ReplaceAllStringFunc(s, func(m string) string {
				parts := varPattern.FindStringSubmatch(m)
				if len(parts) != 3 {
					return m
				}
				nodeID, key := parts[1], parts[2]
				st, ok := run.Nodes[nodeID]
				if !ok || st.Outputs == nil {
					return m
				}
				val, ok := st.Outputs[key]
				if !ok {
					return m
				}
				return fmt.Sprint(val)
			})
		} else {
			out[k] = v
		}
	}
	return out
}

// topoSort returns chain nodes in dependency order. Edges with the
// same From appear in their natural slice order so the canvas's
// left-to-right authoring style usually wins. Returns an error on
// cycles or unknown edge endpoints.
func topoSort(chain Chain) ([]string, error) {
	indeg := map[string]int{}
	out := map[string][]string{}
	exists := map[string]bool{}
	for _, n := range chain.Nodes {
		exists[n.ID] = true
		indeg[n.ID] = 0
	}
	for _, e := range chain.Edges {
		if !exists[e.From] || !exists[e.To] {
			return nil, fmt.Errorf("edge references unknown node: %s -> %s", e.From, e.To)
		}
		out[e.From] = append(out[e.From], e.To)
		indeg[e.To]++
	}
	// Stable order: roots in the order they appear in chain.Nodes.
	var queue []string
	for _, n := range chain.Nodes {
		if indeg[n.ID] == 0 {
			queue = append(queue, n.ID)
		}
	}
	var order []string
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		order = append(order, id)
		for _, nxt := range out[id] {
			indeg[nxt]--
			if indeg[nxt] == 0 {
				queue = append(queue, nxt)
			}
		}
	}
	if len(order) != len(chain.Nodes) {
		return nil, errors.New("chain has a cycle")
	}
	return order, nil
}

func findNode(chain Chain, id string) *ChainNode {
	for i := range chain.Nodes {
		if chain.Nodes[i].ID == id {
			return &chain.Nodes[i]
		}
	}
	return nil
}

// markSubtreeSkipped flags all transitive descendants of `start`. Used
// by condition branching to prune the unselected fork.
func markSubtreeSkipped(chain Chain, start string, skip map[string]bool) {
	stack := []string{start}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if skip[id] {
			continue
		}
		skip[id] = true
		for _, e := range chain.Edges {
			if e.From == id {
				stack = append(stack, e.To)
			}
		}
	}
}

// flushRun persists the run snapshot to disk and publishes a chains
// topic message. Errors are non-fatal (observability shouldn't block
// execution).
func flushRun(d *ChainRunDeps, run *ChainRunStatus) {
	if d == nil || d.ChainsRepo == nil {
		return
	}
	dir := filepath.Join(d.ChainsRepo.Dir(), run.ChainID+".runs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	data, err := json.MarshalIndent(run, "", "  ")
	if err != nil {
		return
	}
	path := filepath.Join(dir, run.RunID+".json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, path)
	if d.Bus != nil {
		d.Bus.Publish(Message{Topic: Topic("chains"), Body: map[string]interface{}{
			"chain_id": run.ChainID,
			"run_id":   run.RunID,
			"state":    run.State,
		}})
	}
}

// loadRun reads a single run from disk.
func loadRun(repo *ChainsRepo, chainID, runID string) (*ChainRunStatus, error) {
	if !validChainID(chainID) || !validChainID(runID) {
		return nil, errors.New("invalid id")
	}
	path := filepath.Join(repo.Dir(), chainID+".runs", runID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var r ChainRunStatus
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// listRuns returns all runs of a chain, newest first.
func listRuns(repo *ChainsRepo, chainID string) ([]ChainRunStatus, error) {
	if !validChainID(chainID) {
		return nil, errors.New("invalid id")
	}
	dir := filepath.Join(repo.Dir(), chainID+".runs")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ChainRunStatus{}, nil
		}
		return nil, err
	}
	out := make([]ChainRunStatus, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var r ChainRunStatus
		if err := json.Unmarshal(data, &r); err != nil {
			continue
		}
		out = append(out, r)
	}
	// Newest first.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// asString / asBool / asInt — defensive helpers for the open-ended
// node.Config map. Wrong type → zero value.
func asString(m map[string]interface{}, k string) string {
	if v, ok := m[k]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func asBool(m map[string]interface{}, k string) bool {
	if v, ok := m[k]; ok {
		switch t := v.(type) {
		case bool:
			return t
		case string:
			return t == "true" || t == "1"
		}
	}
	return false
}

func asInt(m map[string]interface{}, k string) int {
	if v, ok := m[k]; ok {
		switch t := v.(type) {
		case int:
			return t
		case float64:
			return int(t)
		case string:
			var n int
			fmt.Sscanf(t, "%d", &n)
			return n
		}
	}
	return 0
}
