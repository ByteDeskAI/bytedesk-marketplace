import { useEffect, useState } from "react";
import { Markdown } from "../../components/ui/Markdown";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchPlanFile } from "../../lib/api";
import type { PlanFile } from "../../lib/types";

/** A plan file as it reads: a manifest's goals as a list, markdown as markdown. */
export function PlanPreview({ path }: { path: string }) {
  const [file, setFile] = useState<PlanFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    setError(null);
    fetchPlanFile(path)
      .then((f) => live && setFile(f))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [path]);
  if (error) return <p className="tm-faint"><span className="mono">{path}</span> — {error}</p>;
  if (!file) return <SkeletonRows rows={3} height={20} />;
  if (file.manifest && !file.manifest.error) {
    const m = file.manifest;
    return (
      <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
        <strong>{m.epicTitle || m.plan || file.name}</strong>
        <ol className="tm-plan__goals">
          {(m.goals ?? []).map((g) => (
            <li key={g.id}><span className="mono tm-muted">{g.id}</span> {g.title ?? ""}</li>
          ))}
        </ol>
      </div>
    );
  }
  if (file.manifest?.error) return <p className="tm-faint">could not parse manifest: {file.manifest.error}</p>;
  if (file.content) return <Markdown source={file.content} />;
  return <p className="tm-faint mono">{path}</p>;
}
