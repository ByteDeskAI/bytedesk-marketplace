// ── TEMPLATE: ByteDesk Tool Result Viewer ─────────────────────────────────────
// Copy to: src/ByteDesk.Web/src/components/tools/results/{ToolName}ResultView.tsx
// Replace ALL placeholders: {ToolName}, {toolName}, data interface fields
//
// Canonical reference: src/ByteDesk.Web/src/components/tools/results/MarketResearchResultView.tsx
// Viewer is automatically wrapped in ResultViewerShell (Report + Raw Data tabs)
//
// Rules: .claude/rules/frontend.md — design tokens, atoms, no hardcoded colors
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { SomeIcon } from "lucide-react";
import { Badge, Label, MetricCard, MetricGrid } from "@/components/ui";
import { EmptyState } from "@/components/shared";

// ── Data interface (mirrors the C# result DTO shape from Job.Output) ──────────
// Look at a real job's output to define this accurately.
// Use optional fields (?) for anything that may be absent.

interface {ToolName}Item {
  name: string;
  score: number;
  // Add item fields
}

interface {ToolName}Data {
  items?: {ToolName}Item[];
  summary?: string;
  totalFound?: number;
  // Add top-level result fields
}

// ── Variant helpers ─────────────────────────────────────────────────────────
// Derive badge variants from numeric thresholds or string values.
// Use token-based color strings for custom colors — never raw hex.

function scoreBadgeVariant(score: number): "green" | "amber" | "red" | "default" {
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  if (score >= 40) return "red";
  return "default";
}

// ── Viewer component ─────────────────────────────────────────────────────────

export function {ToolName}ResultView({ data }: { data: Record<string, unknown> }) {
  const result = data as unknown as {ToolName}Data;
  const items = result.items ?? [];

  // Empty state — shown before the job completes or if no data returned
  if (items.length === 0) {
    return (
      <EmptyState
        title="No results"
        description="No data was returned for this job."
      />
    );
  }

  // Computed summary metrics
  const avgScore = Math.round(
    items.reduce((sum, item) => sum + (item.score ?? 0), 0) / items.length
  );

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5">
        <SomeIcon className="h-5 w-5" style={{ color: "var(--color-accent-blue)" }} />
        <h3 className="text-h3" style={{ color: "var(--color-text-primary)" }}>
          {ToolName} Results
        </h3>
        {result.totalFound != null && (
          <Badge variant="default">{result.totalFound} found</Badge>
        )}
      </div>

      {/* ── Summary metrics ─────────────────────────────────────────────── */}
      <MetricGrid>
        <MetricCard label="Items Found" value={String(items.length)} />
        <MetricCard
          label="Avg Score"
          value={`${avgScore}/100`}
          color={avgScore >= 70 ? "var(--color-accent-green)" : "var(--color-accent-amber)"}
        />
        {/* Add more MetricCards as appropriate */}
      </MetricGrid>

      {/* ── AI Summary (if present) ─────────────────────────────────────── */}
      {result.summary && (
        <div
          className="rounded-md p-4"
          style={{
            background: "var(--color-bg-ai-subtle)",
            border: "1px solid var(--color-border-default)",
          }}
        >
          <Label muted className="mb-2">AI Summary</Label>
          <p className="text-body-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {result.summary}
          </p>
        </div>
      )}

      {/* ── Item list ───────────────────────────────────────────────────── */}
      <div>
        <Label muted className="mb-3">Results</Label>
        <div className="space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md px-4 py-3"
              style={{
                background: "var(--color-bg-surface)",
                border: "1px solid var(--color-border-default)",
              }}
            >
              <span className="text-body" style={{ color: "var(--color-text-primary)" }}>
                {item.name}
              </span>
              <Badge variant={scoreBadgeVariant(item.score)}>
                {item.score}/100
              </Badge>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ── ResultsRouter.tsx changes needed ─────────────────────────────────────────
// 1. Add lazy import near the other dynamic() calls:
//    const {ToolName}ResultView = dynamic(
//      () => import("./{ToolName}ResultView").then(m => ({ default: m.{ToolName}ResultView })),
//      { loading: () => <ViewerSkeleton /> }
//    );
//
// 2. Add case to the switch in ResultsRouter({ type, data, jobId }):
//    case "{toolName}": return <{ToolName}ResultView data={data} />;
//
// The case string must match the camelCase JobType string in tools.ts exactly.
// ─────────────────────────────────────────────────────────────────────────────
