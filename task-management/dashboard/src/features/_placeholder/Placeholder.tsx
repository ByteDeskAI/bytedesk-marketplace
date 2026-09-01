import { Construction } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { Inspector } from "../../components/ui/Inspector";
import { closeInspector, useLocation } from "../../lib/router";
import type { ScreenProps } from "../../app/routes";

/** Stands in for a screen a feature worker has not landed yet. */
export default function Placeholder({ params }: ScreenProps) {
  const { path } = useLocation();
  const title = path.split("/").filter(Boolean)[0] ?? "board";
  if (params.id) {
    return (
      <Inspector title={params.id} onClose={() => closeInspector()} id={params.id}>
        <EmptyState icon={<Construction size={28} />} title="Inspector in progress">This panel is being built.</EmptyState>
      </Inspector>
    );
  }
  return (
    <div className="tm-screen">
      <div className="tm-screen__head"><h1 style={{ textTransform: "capitalize" }}>{title}</h1></div>
      <EmptyState icon={<Construction size={28} />} title="Screen in progress">This screen is being built. The shell, the feed and the primitives are live.</EmptyState>
    </div>
  );
}
