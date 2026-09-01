/**
 * The route table. One row per screen; feature workers swap the placeholder loader for their
 * own `() => import("../features/<x>/<Screen>")`. `inspector` routes render over `background`
 * (the list route they were opened from, or `fallback`).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import {
  Activity, BookOpenCheck, CalendarRange, Compass, GitFork, HeartPulse, HelpCircle, Inbox, KanbanSquare, LayoutList,
  Lightbulb, Radio, Search, Settings, Sparkles, Sunrise, Layers, type LucideIcon,
} from "lucide-react";
import type { Params } from "../lib/router";

export interface ScreenProps { params: Params }

export interface Route {
  pattern: string;
  title: string;
  icon?: LucideIcon;
  /** Shown on the rail: "primary" always, "secondary" folded on phones, absent = not on the rail. */
  nav?: "primary" | "secondary";
  /** Opens as an inspector over the background list route. */
  inspector?: boolean;
  fallback?: string;
  /** The board owns `/`, `?` and `c` while it is mounted (useBoardKeys); the shell stays out. */
  ownsKeys?: boolean;
  screen: LazyExoticComponent<ComponentType<ScreenProps>>;
}

const placeholder = () => import("../features/_placeholder/Placeholder");

export const ROUTES: Route[] = [
  { pattern: "/board", title: "Board", icon: KanbanSquare, nav: "primary", ownsKeys: true, screen: lazy(() => import("../features/board/Board")) },
  { pattern: "/backlog", title: "Backlog", icon: LayoutList, nav: "primary", ownsKeys: true, screen: lazy(() => import("../features/backlog/Backlog")) },
  { pattern: "/epics", title: "Epics", icon: Layers, nav: "primary", ownsKeys: true, screen: lazy(() => import("../features/epics/Epics")) },
  { pattern: "/sessions", title: "Sessions", icon: Radio, nav: "primary", screen: lazy(() => import("../features/sessions/Sessions")) },
  { pattern: "/graph", title: "Graph", icon: GitFork, nav: "secondary", screen: lazy(() => import("../features/graph/Graph")) },
  { pattern: "/activity", title: "Activity", icon: Activity, nav: "secondary", screen: lazy(() => import("../features/activity/Activity")) },
  { pattern: "/standup", title: "Standup", icon: Sunrise, nav: "secondary", screen: lazy(() => import("../features/standup/Standup")) },
  { pattern: "/sprints", title: "Sprints", icon: CalendarRange, nav: "secondary", screen: lazy(() => import("../features/sprints/Sprints")) },
  { pattern: "/capabilities", title: "Capabilities", icon: Lightbulb, nav: "secondary", screen: lazy(() => import("../features/capabilities/Capabilities")) },
  { pattern: "/decisions", title: "Decisions", icon: BookOpenCheck, nav: "secondary", screen: lazy(() => import("../features/decisions/Decisions")) },
  { pattern: "/plans", title: "Plans", icon: Inbox, nav: "secondary", screen: lazy(() => import("../features/plans/Plans")) },
  { pattern: "/search", title: "Search", icon: Search, nav: "secondary", screen: lazy(() => import("../features/search/Search")) },
  { pattern: "/reports", title: "Reports", icon: Compass, nav: "secondary", screen: lazy(() => import("../features/reports/Reports")) },
  { pattern: "/doctor", title: "Doctor", icon: HeartPulse, nav: "secondary", screen: lazy(() => import("../features/doctor/Doctor")) },
  { pattern: "/settings", title: "Settings", icon: Settings, nav: "secondary", screen: lazy(() => import("../features/settings/Settings")) },
  { pattern: "/help", title: "Help", icon: HelpCircle, nav: "secondary", screen: lazy(() => import("./Help")) },
  // inspectors
  { pattern: "/tasks/:id", title: "Task", inspector: true, fallback: "/board", screen: lazy(() => import("../features/task/TaskInspector")) },
  { pattern: "/epics/:id", title: "Epic", inspector: true, fallback: "/epics", screen: lazy(() => import("../features/epics/EpicInspector")) },
  { pattern: "/sprints/:id", title: "Sprint", inspector: true, fallback: "/sprints", screen: lazy(() => import("../features/sprints/SprintInspector")) },
  { pattern: "/capabilities/:id", title: "Capability", inspector: true, fallback: "/capabilities", screen: lazy(() => import("../features/capabilities/CapabilityInspector")) },
  { pattern: "/decisions/:id", title: "Decision", inspector: true, fallback: "/decisions", screen: lazy(() => import("../features/decisions/DecisionInspector")) },
];

/** Where a bare id lives: TM-014 → /tasks/TM-014. */
export function routeForId(id: string): string | null {
  if (id.startsWith("TM-")) return `/tasks/${id}`;
  if (id.startsWith("EP-")) return `/epics/${id}`;
  if (id.startsWith("SP-")) return `/sprints/${id}`;
  if (id.startsWith("CAP-")) return `/capabilities/${id}`;
  if (id.startsWith("ADR-")) return `/decisions/${id}`;
  return null;
}

export const Sparkle = Sparkles;
