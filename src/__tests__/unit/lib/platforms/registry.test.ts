import { describe, it, expect } from "vitest";
import { PLATFORM_ICONS, PLATFORMS } from "@/lib/platforms/registry";

describe("PLATFORM_ICONS", () => {
  it("includes every platform that ships its own path data", () => {
    for (const platform of PLATFORMS) {
      if (platform.paths.length === 0) {
        // Generic primitives (server / database / cloud / ...) carry
        // no paths of their own; their glyphs live inside the lib's
        // built-in icon map. Omitted from `PLATFORM_ICONS` on purpose
        // so the lib's `customIcons?.[id] ?? iconPaths[id]` lookup
        // falls through to the built-in.
        expect(PLATFORM_ICONS[platform.id]).toBeUndefined();
        continue;
      }
      expect(PLATFORM_ICONS[platform.id]).toBeDefined();
      expect(PLATFORM_ICONS[platform.id].length).toBe(platform.paths.length);
    }
  });

  it("preserves the original simple-icons path data verbatim", () => {
    // The lib's path-data scaler (`scalePathData` in
    // `system-canvas-react/components/NodeIcon`) handles compact-form
    // path data (`.5`, `-.23`) directly — we don't need to massage
    // paths before handing them to the theme. This test pins that
    // contract: if the lib ever regresses, the renderer will mis-scale
    // brand glyphs and the hive surface will paint garbage; the hive
    // test fails first, before users see broken icons.
    for (const platform of PLATFORMS) {
      if (platform.paths.length === 0) continue;
      expect(PLATFORM_ICONS[platform.id]).toEqual(platform.paths);
    }
  });
});
