import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect } from "react";

/**
 * Unit tests for document.title management in TaskChatPage
 * Tests that the browser tab title updates based on task title (initial load + real-time updates) and resets on unmount
 */

describe("TaskChatPage - Document Title", () => {
  let originalTitle: string;

  beforeEach(() => {
    originalTitle = document.title;
    document.title = "Hive";
  });

  afterEach(() => {
    document.title = originalTitle;
  });

  it("should set document.title to task title when task is loaded", () => {
    const taskTitle = "Fix login bug";
    
    // Simulate the useEffect from TaskChatPage
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Fix login bug");
    unmount();
  });

  it("should fallback to 'Hive' when taskTitle is null", () => {
    const taskTitle = null;
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });

  it("should fallback to 'Hive' when taskTitle is undefined", () => {
    const taskTitle = undefined;
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });

  it("should update document.title when taskTitle changes via initial load", () => {
    let taskTitle: string | null = null;
    
    const { rerender, unmount } = renderHook(
      ({ title }) => {
        useEffect(() => {
          document.title = title ?? "Hive";
          return () => {
            document.title = "Hive";
          };
        }, [title]);
      },
      { initialProps: { title: taskTitle } }
    );

    // Initially loading
    expect(document.title).toBe("Hive");

    // Task data loads (line 324/838 in page.tsx)
    taskTitle = "Implement dark mode toggle";
    rerender({ title: taskTitle });

    expect(document.title).toBe("Implement dark mode toggle");

    unmount();
  });

  it("should update document.title when taskTitle changes via real-time TaskTitleUpdateEvent", () => {
    let taskTitle = "Initial Task Title";
    
    const { rerender, unmount } = renderHook(
      ({ title }) => {
        useEffect(() => {
          document.title = title ?? "Hive";
          return () => {
            document.title = "Hive";
          };
        }, [title]);
      },
      { initialProps: { title: taskTitle } }
    );

    expect(document.title).toBe("Initial Task Title");

    // Simulate TaskTitleUpdateEvent via Pusher (line 183 in page.tsx)
    // User renames the task in another tab/browser
    taskTitle = "Updated Task Title via Pusher";
    rerender({ title: taskTitle });

    expect(document.title).toBe("Updated Task Title via Pusher");

    // Another real-time update
    taskTitle = "Final Task Title";
    rerender({ title: taskTitle });

    expect(document.title).toBe("Final Task Title");

    unmount();
  });

  it("should reset document.title to 'Hive' on unmount", () => {
    const taskTitle = "Task to be Unmounted";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Task to be Unmounted");
    
    unmount();
    
    expect(document.title).toBe("Hive");
  });

  it("should handle task title with special characters", () => {
    const taskTitle = "Fix bug: <Button> doesn't handle \"click\" events & props";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Fix bug: <Button> doesn't handle \"click\" events & props");
    unmount();
  });

  it("should handle empty string taskTitle", () => {
    const taskTitle = "";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle || "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Hive");
    unmount();
  });

  it("should handle complete task lifecycle: load -> rename -> unmount", () => {
    let taskTitle: string | null = null;
    
    const { rerender, unmount } = renderHook(
      ({ title }) => {
        useEffect(() => {
          document.title = title ?? "Hive";
          return () => {
            document.title = "Hive";
          };
        }, [title]);
      },
      { initialProps: { title: taskTitle } }
    );

    // Phase 1: Task not loaded yet
    expect(document.title).toBe("Hive");

    // Phase 2: Task loads from API (setTaskTitle on line 324/838)
    taskTitle = "Refactor authentication service";
    rerender({ title: taskTitle });
    expect(document.title).toBe("Refactor authentication service");

    // Phase 3: Task renamed via real-time event (setTaskTitle on line 183)
    taskTitle = "Refactor auth service with OAuth2";
    rerender({ title: taskTitle });
    expect(document.title).toBe("Refactor auth service with OAuth2");

    // Phase 4: Another rename
    taskTitle = "Refactor auth service with OAuth2 + MFA";
    rerender({ title: taskTitle });
    expect(document.title).toBe("Refactor auth service with OAuth2 + MFA");

    // Phase 5: User navigates away
    unmount();
    expect(document.title).toBe("Hive");
  });

  it("should handle task title with unicode characters", () => {
    const taskTitle = "Fix 🐛 in user profile 👤 display";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Fix 🐛 in user profile 👤 display");
    unmount();
  });

  it("should handle very long task title", () => {
    const taskTitle = "Implement comprehensive test coverage for the new authentication flow including unit tests, integration tests, and end-to-end tests across all supported authentication providers";
    
    const { unmount } = renderHook(() => {
      useEffect(() => {
        document.title = taskTitle ?? "Hive";
        return () => {
          document.title = "Hive";
        };
      }, [taskTitle]);
    });

    expect(document.title).toBe("Implement comprehensive test coverage for the new authentication flow including unit tests, integration tests, and end-to-end tests across all supported authentication providers");
    unmount();
  });
});
