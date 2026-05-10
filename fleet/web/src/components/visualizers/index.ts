// Visualizer barrel — every per-tool module's `register()` runs here
// so the registry is populated before MessageBubble renders. Side-
// effecting imports keep individual modules self-contained: each one
// owns its tool-name string and registers its component, no central
// switch statement to update.
//
// Order: file → shell → web → misc → mcp fallback. Last registration
// wins, so the mcp wildcard is loaded last on purpose.

import './fileVisualizers';
import './shellSearchVisualizers';
import './webTaskVisualizers';
import './miscVisualizers';

export { getToolVisualizer, type ToolVisualizer, type ToolVisualizerProps } from './registry';
