/**
 * A number that moved says so.
 *
 * Column counts, epic tallies and acceptance progress are the things you scan rather than read, so
 * a change in one is easy to miss entirely — especially a change made by another session or by the
 * CLI, which is most of them on this board.
 *
 * One animation, on change, then still: nothing here loops. Reduced motion drops the movement and
 * loses nothing, because the number itself is the information.
 */
import type { ReactNode } from "react";
import { cssMap } from "@atlaskit/css";
import { useChanged } from "../motion";

const styles = cssMap({
  still: { display: "inline-flex" },
  bumped: {
    display: "inline-flex",
    animationName: "tmBump",
    animationDuration: "400ms",
    animationTimingFunction: "ease-out",
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
});

export function Bump({ on, children }: { on: unknown; children: ReactNode }) {
  const changed = useChanged(on, 500);
  // Array form, not a ternary: @compiled extracts statically, and `css={a ? x : y}` fails the build.
  return <span css={[styles.still, changed && styles.bumped]}>{children}</span>;
}
