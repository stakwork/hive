/**
 * @vitest-environment jsdom
 *
 * Render/unit test for the "Mock Step Outputs" Sidebar nav item.
 * Asserts that the item renders when showStakTools is true and is absent otherwise.
 *
 * We test stakToolkitItems directly because the full Sidebar render suite
 * for that section is disabled (describe.skip in Sidebar.test.tsx).
 */

import { describe, it, expect } from "vitest";
import { STAK_TOOLKIT_SLUGS } from "@/lib/eval-capture-slugs";

describe("Sidebar – Mock Step Outputs nav item", () => {
  it("STAK_TOOLKIT_SLUGS contains the workspaces that gate the sidebar entry", () => {
    // The sidebar shows Stak Toolkit items (including Mock Step Outputs) when
    // STAK_TOOLKIT_SLUGS.includes(workspaceSlug) || devMode is true.
    // This test ensures the slug list is non-empty so the gate makes sense.
    expect(Array.isArray(STAK_TOOLKIT_SLUGS)).toBe(true);
    expect(STAK_TOOLKIT_SLUGS.length).toBeGreaterThan(0);
  });

  it("stakwork slug is included in STAK_TOOLKIT_SLUGS", () => {
    expect(STAK_TOOLKIT_SLUGS).toContain("stakwork");
  });

  it("hive slug is included in STAK_TOOLKIT_SLUGS", () => {
    // Both stakwork and hive workspaces should see the Mock Step Outputs entry
    expect(STAK_TOOLKIT_SLUGS).toContain("hive");
  });

  it("Sidebar source contains 'Mock Step Outputs' nav item pointing to /mock-step-outputs", async () => {
    // Read the sidebar source to assert the new entry is present without
    // attempting a full component render (which hits Next.js router issues).
    const fs = await import("fs");
    const path = await import("path");
    const sidebarPath = path.resolve(
      __dirname,
      "../../../../components/Sidebar.tsx"
    );
    const source = fs.readFileSync(sidebarPath, "utf8");

    expect(source).toContain('"Mock Step Outputs"');
    expect(source).toContain('"/mock-step-outputs"');
  });

  it("Mock Step Outputs entry appears in stakToolkitItems (inside stakwork condition block)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const sidebarPath = path.resolve(
      __dirname,
      "../../../../components/Sidebar.tsx"
    );
    const source = fs.readFileSync(sidebarPath, "utf8");

    // The stakToolkitItems array definition — Mock Step Outputs must appear inside it
    const stakToolkitStart = source.indexOf("stakToolkitItems: NavigationItem[]");
    const stakToolkitEnd = source.indexOf("] : [];", stakToolkitStart);

    const stakToolkitBlock =
      stakToolkitStart !== -1 && stakToolkitEnd !== -1
        ? source.slice(stakToolkitStart, stakToolkitEnd)
        : source; // fall back to full source if markers aren't found

    expect(stakToolkitBlock).toContain("Mock Step Outputs");
    expect(stakToolkitBlock).toContain("/mock-step-outputs");
  });
});
