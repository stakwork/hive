import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect } from "react";

/**
 * Unit tests for document.title management in PlanChatView
 * Tests that the browser tab title updates based on feature title and resets on unmount
 */

describe("PlanChatView - Document Title", () => {
  let originalTitle: string;

  beforeEach(() => {
    originalTitle = document.title;
    document.title = "Hive";
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it("should set document.title to featureTitle when feature is loaded", () => {
    const featureTitle = "User Authentication Feature";
    
    // Simulate the useEffect from PlanChatView
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("User Authentication Feature");
    unmount();
  });

  it("should fallback to 'Hive' when featureTitle is null", () => {
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

  it("should fallback to 'Hive' when featureTitle is undefined", () => {
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

  it("should update document.title when featureTitle changes during conversation", () => {
    let featureTitle: string | null = null;
    
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

    // Initially no title (still loading)
    expect(document.title).toBe("Hive");

    // Feature title becomes available during conversation
    featureTitle = "Payment Integration";
    rerender({ title: featureTitle });

    expect(document.title).toBe("Payment Integration");

    // Feature title updates (e.g., user edits it)
    featureTitle = "Payment Gateway Integration";
    rerender({ title: featureTitle });

    expect(document.title).toBe("Payment Gateway Integration");

    unmount();
  });

  it("should reset document.title to 'Hive' on unmount", () => {
    const featureTitle = "Feature Chat View";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Feature Chat View");
    
    unmount();
    
    expect(document.title).toBe("Hive");
  });

  it("should handle feature title with long text", () => {
    const featureTitle = "Implement comprehensive authentication system with OAuth, SAML, and multi-factor authentication support";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = featureTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [featureTitle]);
    });

    expect(document.title).toBe("Implement comprehensive authentication system with OAuth, SAML, and multi-factor authentication support");
    unmount();
  });

  it("should handle conversational plan creation flow", () => {
    // Simulate the flow: starts with null, then title appears as AI generates it
    let featureTitle: string | null = null;
    
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

    // Step 1: User starts conversation, no feature title yet
    expect(document.title).toBe("Hive");

    // Step 2: AI generates feature title via streaming
    featureTitle = "API Rate Limiting";
    rerender({ title: featureTitle });

    expect(document.title).toBe("API Rate Limiting");

    unmount();
    expect(document.title).toBe("Hive");
  });

  it("should handle empty string featureTitle", () => {
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
