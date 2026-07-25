import Avatar from "@atlaskit/avatar";
import { Inline, Text } from "@atlaskit/primitives/compiled";
import Tooltip from "@atlaskit/tooltip";

/**
 * The thread executing a piece of work: `main`, `@teammate`, `subagent:abc123`.
 * lib/actor.mjs already produces the label — this only paints it.
 */
export function ActorBadge({ actor }: { actor?: string | null }) {
  if (!actor) return null;
  const teammate = actor.startsWith("@");
  const short = teammate ? actor.slice(1) : actor.replace(/^subagent:/, "");
  return (
    <Tooltip content={`executing thread: ${actor}`}>
      <Inline space="space.050" alignBlock="center">
        <Avatar size="xsmall" name={actor} appearance="square" />
        <Text size="small" color={actor === "main" ? "color.text.subtlest" : "color.text.accent.purple"}>
          {short}
        </Text>
      </Inline>
    </Tooltip>
  );
}
