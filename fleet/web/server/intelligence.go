package main

// Intelligence layer — Phase 8 (BDM-24).
//
// Three concerns currently bundled here:
//
//   - JudgeState (B10): "what is the agent doing right now?" Today =
//     regex-on-log-tail (already done by sessionStateFromLog). Tomorrow
//     = Haiku call with the last ~60 lines and the original prompt.
//   - DriftScore (B11): "how likely is it that the agent has lost the
//     plot?" 0..1 stub today; Haiku later.
//   - EstimateCost (B12): "before I spawn this, what's it likely to
//     cost?" Heuristic over prompt length today; Haiku later.
//
// Each function is exposed via a JudgeProvider interface (Strategy
// pattern). The default heuristic provider is wired up at server start;
// a HaikuProvider can replace it without changing the wire shape.

import (
	"io"
	"os"
	"strings"
	"time"
)

// readLogTail returns the last `bytes` bytes of a log file. Returns ""
// on any error (judge stays correct against an empty tail).
func readLogTail(path string, bytes int64) string {
	if path == "" {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return ""
	}
	off := int64(0)
	if info.Size() > bytes {
		off = info.Size() - bytes
	}
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		return ""
	}
	b, err := io.ReadAll(f)
	if err != nil {
		return ""
	}
	return string(b)
}

// JudgeProvider — the seam for swapping in Haiku later. All methods
// must be cheap + non-blocking; the server calls them on every
// /api/sessions request, so a real Haiku provider should cache.
type JudgeProvider interface {
	JudgeState(s Session, logTail string) (state string, confidence float64, objective string)
	DriftScore(s Session, logTail string) float64
	EstimateCost(prompt string, fullAuto bool) (usdLow, usdHigh float64)
}

// heuristicJudge — today's default. Pure function, no I/O, no LLM.
type heuristicJudge struct{}

func newJudgeProvider() JudgeProvider { return heuristicJudge{} }

// JudgeState — keeps state from the regex pass; computes a confidence
// score that rises with how recently the heuristic-matched line ran.
func (heuristicJudge) JudgeState(s Session, logTail string) (string, float64, string) {
	state := s.State
	conf := 0.5
	if !s.LastActivity.IsZero() {
		ago := time.Since(s.LastActivity)
		switch {
		case ago < 30*time.Second:
			conf = 0.9
		case ago < 2*time.Minute:
			conf = 0.7
		case ago < 10*time.Minute:
			conf = 0.55
		default:
			conf = 0.4
		}
	}
	if state == "needs-input" || state == "blocked" || state == "error" {
		conf = 0.95 // explicit signal in the log
	}
	return state, conf, firstNonEmptyLine(logTail)
}

// DriftScore — proxy for "is the agent stuck?": rising for sessions
// that have been working without log activity for long stretches.
// Bounded 0..1.
func (heuristicJudge) DriftScore(s Session, _ string) float64 {
	if s.LastActivity.IsZero() {
		return 0
	}
	if s.State == "done" || s.State == "completed" || s.State == "idle" {
		return 0
	}
	ago := time.Since(s.LastActivity)
	switch {
	case ago < 2*time.Minute:
		return 0.05
	case ago < 5*time.Minute:
		return 0.2
	case ago < 15*time.Minute:
		return 0.5
	case ago < 60*time.Minute:
		return 0.8
	default:
		return 0.95
	}
}

// EstimateCost — order-of-magnitude estimate from prompt size +
// full-auto flag. Real version asks Haiku to look at prompt complexity.
//
// Calibration target: today's flat-rate $5/Mtoken with a 5x output
// multiplier means ~$0.0025 per 1k input + a hand-waved working budget.
//
//	words   ≈ chars / 5
//	input   ≈ 4 * words tokens (prompt + context preamble)
//	output  ≈ 30k tokens for non-full-auto, 80k for full-auto
//	total $ ≈ (input + output) * 5 / 1_000_000
func (heuristicJudge) EstimateCost(prompt string, fullAuto bool) (float64, float64) {
	chars := len(prompt)
	if chars == 0 {
		return 0, 0
	}
	inputTokens := chars / 5 * 4
	outputLow := 30000
	outputHigh := 80000
	if fullAuto {
		outputLow = 60000
		outputHigh = 200000
	}
	low := float64(inputTokens+outputLow) * 5.0 / 1_000_000
	high := float64(inputTokens+outputHigh) * 5.0 / 1_000_000
	return low, high
}

func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimSpace(line)
		if t != "" {
			if len(t) > 120 {
				t = t[:120] + "…"
			}
			return t
		}
	}
	return ""
}
