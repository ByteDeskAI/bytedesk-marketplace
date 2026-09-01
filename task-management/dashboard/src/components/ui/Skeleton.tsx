import type { CSSProperties } from "react";

/** A shape-matched placeholder, never a spinner in the middle of nothing. */
export function Skeleton({ width, height = 12, style }: { width?: string | number; height?: string | number; style?: CSSProperties }) {
  return <span className="tm-skel" aria-hidden style={{ width, height, ...style }} />;
}

export function SkeletonRows({ rows = 4, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="tm-stack" aria-busy="true" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} />
      ))}
    </div>
  );
}
