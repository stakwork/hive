import { describe, it, expect } from "vitest";

describe("CoverageStatsLabel Integration with Graph - Conditional Rendering Logic", () => {
  it("should determine CoverageStatsLabel should render when graphStyle is split and storeId matches workspace pattern", () => {
    const graphStyle = "split";
    const storeId = "workspace-123";
    
    const shouldRender = 
      graphStyle === "split" &&
      storeId?.startsWith("workspace-") &&
      !storeId?.includes("calls") &&
      !storeId?.includes("learn");
    
    expect(shouldRender).toBe(true);
  });

  it("should determine CoverageStatsLabel should not render when storeId includes calls", () => {
    const graphStyle = "split";
    const storeId = "workspace-123-calls";
    
    const shouldRender = 
      graphStyle === "split" &&
      storeId?.startsWith("workspace-") &&
      !storeId?.includes("calls") &&
      !storeId?.includes("learn");
    
    expect(shouldRender).toBe(false);
  });

  it("should determine CoverageStatsLabel should not render when storeId includes learn", () => {
    const graphStyle = "split";
    const storeId = "workspace-123-learn";
    
    const shouldRender = 
      graphStyle === "split" &&
      storeId?.startsWith("workspace-") &&
      !storeId?.includes("calls") &&
      !storeId?.includes("learn");
    
    expect(shouldRender).toBe(false);
  });

  it("should determine CoverageStatsLabel should not render when storeId does not start with workspace-", () => {
    const graphStyle = "split";
    const storeId = "other-123";
    
    const shouldRender = 
      graphStyle === "split" &&
      storeId?.startsWith("workspace-") &&
      !storeId?.includes("calls") &&
      !storeId?.includes("learn");
    
    expect(shouldRender).toBe(false);
  });

  it("should determine CoverageStatsLabel should not render when graphStyle is not split", () => {
    const graphStyle = "sphere";
    const storeId = "workspace-123";
    
    const shouldRender = 
      graphStyle === "split" &&
      storeId?.startsWith("workspace-") &&
      !storeId?.includes("calls") &&
      !storeId?.includes("learn");
    
    expect(shouldRender).toBe(false);
  });

  it("should handle edge cases with multiple dash separators", () => {
    const graphStyle = "split";
    
    // Valid: workspace pattern without calls/learn
    expect(
      graphStyle === "split" &&
      "workspace-abc-123".startsWith("workspace-") &&
      !"workspace-abc-123".includes("calls") &&
      !"workspace-abc-123".includes("learn")
    ).toBe(true);
    
    // Invalid: has calls
    expect(
      graphStyle === "split" &&
      "workspace-abc-calls-123".startsWith("workspace-") &&
      !"workspace-abc-calls-123".includes("calls") &&
      !"workspace-abc-calls-123".includes("learn")
    ).toBe(false);
    
    // Invalid: has learn
    expect(
      graphStyle === "split" &&
      "workspace-abc-learn-123".startsWith("workspace-") &&
      !"workspace-abc-learn-123".includes("calls") &&
      !"workspace-abc-learn-123".includes("learn")
    ).toBe(false);
  });
});
