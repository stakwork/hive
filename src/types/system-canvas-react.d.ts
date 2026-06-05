/**
 * Module augmentation for system-canvas-react.
 * Extends SystemCanvasHandle with getSvgElement() which was added in the
 * local system-canvas package but not yet published to the npm registry.
 */
import "system-canvas-react";

declare module "system-canvas-react" {
  interface SystemCanvasHandle {
    /**
     * Returns the underlying SVG element used by the canvas viewport.
     * Lets external collaboration hooks measure the same bounding rect
     * that d3-zoom uses as its coordinate origin.
     */
    getSvgElement: () => SVGSVGElement | null;
  }
}
