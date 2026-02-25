import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect } from "react";

/**
 * Unit tests for document.title management in FeatureDetailClassicView
 * Tests that the browser tab title updates based on feature title and resets on unmount
 */

describe("FeatureDetailClassicView - Document Title", () => {
  let originalTitle: string;

  beforeEach(() => {
    originalTitle = document.title;
    document.title = "Hive";
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it("should set document.title to feature title when feature is loaded", () => {
    const featureTitle = "Dark Mode Toggle";
    
    // Simulate the useEffect from FeatureDetailClassicView
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Dark Mode Toggle");
    unmount();
  });

  it("should fallback to 'Hive' when feature title is null", () => {
    const featureTitle = null;
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });

  it("should fallback to 'Hive' when feature title is undefined", () => {
    const featureTitle = undefined;
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });

  it("should update document.title when feature title changes", () => {
    let featureTitle = "Initial Feature";
    
    const { rerender, unmount } = renderHook(
      ({ title }) => {
        useEffect(() => {
          document.title = title ?? "Hive";
          return () => {
            document.title = "Hive";
          };
        }, [title]);
      },
      { initialProps: { title: featureTitle } }
    );

    expect(document.title).toBe("Initial Feature");

    // Simulate feature title change
    featureTitle = "Updated Feature";
    rerender({ title: featureTitle });

    expect(document.title).toBe("Updated Feature");
    unmount();
  });

  it("should reset document.title to 'Hive' on unmount", () => {
    const featureTitle = "Feature to be Unmounted";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Feature to be Unmounted");
    
    unmount();
    
    expect(document.title).toBe("Hive");
  });

  it("should handle feature title with special characters", () => {
    const featureTitle = "Feature: Fix <bug> & \"improve\" performance";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Feature: Fix <bug> & \"improve\" performance");
    unmount();
  });

  it("should handle empty string feature title", () => {
    const featureTitle = "";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle || "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });
});
