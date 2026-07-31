/**
 * A render error becomes text on the page instead of a blank screen.
 *
 * React unmounts the whole tree when a component throws, so one bad prop in the drawer painted an
 * empty board and said nothing — in a browser with no console open, that is indistinguishable from
 * a hung server. The message has to be *in the DOM*: that is what a screenshot shows, what a
 * screen reader announces, and what an automated check can assert on.
 *
 * Deliberately not a fallback that hides the problem. It names the component that failed and
 * prints the error, because the next person to see this will be debugging it.
 */
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { cssMap } from "@atlaskit/css";
import { Box, Stack, Text } from "@atlaskit/primitives/compiled";

const styles = cssMap({
  wrap: {
    backgroundColor: "var(--ds-background-danger)",
    borderRadius: "var(--ds-radius-medium)",
    padding: "var(--ds-space-150)",
  },
  code: { fontFamily: "var(--ds-font-family-code)", whiteSpace: "pre-wrap" },
});

interface Props {
  children: ReactNode;
  /** What failed, in words a human recognises — shown above the error. */
  what: string;
}

export class Boundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Still log it: a developer with devtools open should not have to read the page to get a stack.
    console.error(`[${this.props.what}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Box xcss={styles.wrap}>
        <Stack space="space.075">
          <Text size="small" weight="bold">
            {this.props.what} failed to render
          </Text>
          <Box xcss={styles.code}>
            <Text size="small">{String(error?.message || error)}</Text>
          </Box>
        </Stack>
      </Box>
    );
  }
}
