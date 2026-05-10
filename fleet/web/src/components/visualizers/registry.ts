// Tool visualizer registry — maps `tool_name` to a specialized
// component. MessageBubble's ToolCallView consults this registry; if
// no entry exists, it falls back to the generic input/output JSON
// dump that's been there since BDM-32.
//
// Registration is static: each module under
// `fleet/web/src/components/visualizers/` exports a `register` that
// adds entries here, and `index.ts` calls them all on import. Keeps
// the dispatch table in one place + lets esbuild tree-shake unused
// visualizers (none today, but future-proofs).
//
// A visualizer takes the tool's input + the tool_result output + the
// state and returns JSX. Implementations should:
//   - render `running` state cleanly (input only, no output yet)
//   - render `done` with a useful summary or detail toggle
//   - render `error` with the output styled red
// For tools where the output is "File X created/edited" boilerplate,
// hide it; the input alone is enough.

import type { ComponentChildren } from 'preact';

export interface ToolVisualizerProps {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  output?: string;
  state?: 'running' | 'done' | 'error';
}

export type ToolVisualizer = (props: ToolVisualizerProps) => ComponentChildren;

const registry = new Map<string, ToolVisualizer>();

export function registerToolVisualizer(name: string, fn: ToolVisualizer): void {
  registry.set(name, fn);
}

export function registerToolVisualizers(map: Record<string, ToolVisualizer>): void {
  for (const [name, fn] of Object.entries(map)) registry.set(name, fn);
}

export function getToolVisualizer(name: string): ToolVisualizer | undefined {
  // Direct hit first.
  if (registry.has(name)) return registry.get(name);
  // MCP tools follow `mcp__<server>__<tool>` — registries can choose
  // to register the prefix `mcp__*` as a wildcard fallback.
  if (name.startsWith('mcp__') && registry.has('mcp__*')) return registry.get('mcp__*');
  return undefined;
}
