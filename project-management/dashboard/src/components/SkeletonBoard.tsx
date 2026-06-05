import React from "react";

const shimmerStyle: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--ds-surface-raised) 25%, var(--ds-surface-overlay) 50%, var(--ds-surface-raised) 75%)",
  backgroundSize: "200% 100%",
  animation: "shimmer 1.5s infinite",
  borderRadius: 3,
};

const SkeletonCard: React.FC = () => (
  <div
    style={{
      background: "var(--ds-surface-raised)",
      borderRadius: 6,
      padding: 12,
      marginTop: 8,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}
  >
    <div style={{ ...shimmerStyle, height: 14, width: "80%" }} />
    <div style={{ ...shimmerStyle, height: 10, width: "55%" }} />
  </div>
);

const SkeletonColumn: React.FC = () => (
  <div
    style={{
      background: "var(--ds-surface-raised)",
      borderRadius: 8,
      padding: 12,
    }}
  >
    <div style={{ ...shimmerStyle, height: 18, width: "60%", marginBottom: 4 }} />
    <SkeletonCard />
    <SkeletonCard />
  </div>
);

const SkeletonBoard: React.FC = () => (
  <>
    <style>{`
      @keyframes shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }
    `}</style>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 12,
      }}
    >
      <SkeletonColumn />
      <SkeletonColumn />
      <SkeletonColumn />
      <SkeletonColumn />
    </div>
  </>
);

export default SkeletonBoard;
