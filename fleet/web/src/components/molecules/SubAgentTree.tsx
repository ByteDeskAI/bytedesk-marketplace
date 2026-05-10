// SubAgentTree — Phase 12.x (feature #15). Renders the sub-agents the
// session has spawned. Today receives a flat string[] from
// TicketStats.sub_agents; rendered as a tree-ish indented list so the
// shape can grow into a nested structure later without a breaking
// rewrite.
//
// TODO(server): the transcript stream does not yet populate
// `sub_agents`. Once spawn correlation lands, the same component will
// pick up the data with no API change.

export interface SubAgentTreeProps {
  agents?: string[];
}

export function SubAgentTree({ agents }: SubAgentTreeProps) {
  const list = (agents ?? []).filter((s) => typeof s === 'string' && s.length > 0);

  return (
    <section class="sub-agent-tree">
      <h4 class="sub-agent-tree__title">Sub-agents</h4>
      {list.length === 0 ? (
        <div class="sub-agent-tree__empty">No sub-agents spawned</div>
      ) : (
        <ul class="sub-agent-tree__list">
          {list.map((name, i) => (
            <li key={`${name}-${i}`} class="sub-agent-tree__row">
              <span class="sub-agent-tree__bullet" aria-hidden="true">└─</span>
              <span class="sub-agent-tree__name">{name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
