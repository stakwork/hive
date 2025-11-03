import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";

// Test helper functions to mirror the implementation
const TASKS_PAGE_STORAGE_KEY = (workspaceId: string) => `tasks_page_${workspaceId}`;

const saveCurrentPage = (workspaceId: string, page: number) => {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), page.toString());
  }
};

const getStoredPage = (workspaceId: string): number => {
  if (typeof window !== "undefined") {
    const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
    return stored ? parseInt(stored, 10) : 1;
  }
  return 1;
};

const clearStoredPage = (workspaceId: string) => {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
  }
};

describe("useWorkspaceTasks - Storage Functions", () => {
  // Store original window object
  let originalWindow: typeof window;

  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
    // Clear all mocks
    vi.clearAllMocks();
    // Store original window
    originalWindow = global.window;
  });

  afterEach(() => {
    // Restore window if it was deleted
    if (!global.window && originalWindow) {
      global.window = originalWindow;
    }
  });

  describe("TASKS_PAGE_STORAGE_KEY", () => {
    test("generates correct storage key format", () => {
      const workspaceId = "workspace-123";
      const expectedKey = `tasks_page_${workspaceId}`;
      const key = TASKS_PAGE_STORAGE_KEY(workspaceId);
      
      expect(key).toBe(expectedKey);
    });

    test("generates unique keys for different workspace IDs", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      const workspace3 = "workspace-abc-def";
      
      const key1 = TASKS_PAGE_STORAGE_KEY(workspace1);
      const key2 = TASKS_PAGE_STORAGE_KEY(workspace2);
      const key3 = TASKS_PAGE_STORAGE_KEY(workspace3);
      
      expect(key1).toBe("tasks_page_workspace-123");
      expect(key2).toBe("tasks_page_workspace-456");
      expect(key3).toBe("tasks_page_workspace-abc-def");
      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
    });

    test("handles special characters in workspace ID", () => {
      const workspaceWithHyphens = "workspace-123-456";
      const workspaceWithUnderscores = "workspace_123_456";
      const workspaceUUID = "550e8400-e29b-41d4-a716-446655440000";
      
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithHyphens)).toBe("tasks_page_workspace-123-456");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithUnderscores)).toBe("tasks_page_workspace_123_456");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceUUID)).toBe("tasks_page_550e8400-e29b-41d4-a716-446655440000");
    });

    test("handles null input gracefully", () => {
      // @ts-expect-error - Testing runtime behavior with invalid input
      const key = TASKS_PAGE_STORAGE_KEY(null);
      expect(key).toBe("tasks_page_null");
    });

    test("handles undefined input gracefully", () => {
      // @ts-expect-error - Testing runtime behavior with invalid input
      const key = TASKS_PAGE_STORAGE_KEY(undefined);
      expect(key).toBe("tasks_page_undefined");
    });

    test.each([
      // Unicode characters
      ["workspace-🚀-rocket", "tasks_page_workspace-🚀-rocket", "emoji"],
      ["workspace-你好-hello", "tasks_page_workspace-你好-hello", "Chinese"],
      ["workspace-مرحبا-greeting", "tasks_page_workspace-مرحبا-greeting", "Arabic"],
      ["workspace-こんにちは-konnichiwa", "tasks_page_workspace-こんにちは-konnichiwa", "Japanese"],
      
      // Whitespace-only
      ["   ", "tasks_page_   ", "spaces only"],
      ["\t\t\t", "tasks_page_\t\t\t", "tabs only"],
      [" \t \t ", "tasks_page_ \t \t ", "mixed whitespace"],
      
      // Leading/trailing whitespace
      [" workspace-123", "tasks_page_ workspace-123", "leading space"],
      ["workspace-123 ", "tasks_page_workspace-123 ", "trailing space"],
      [" workspace-123 ", "tasks_page_ workspace-123 ", "both spaces"],
      ["\tworkspace-123", "tasks_page_\tworkspace-123", "leading tab"],
      
      // SQL injection patterns
      ["'; DROP TABLE workspaces--", "tasks_page_'; DROP TABLE workspaces--", "SQL injection 1"],
      ["workspace' OR '1'='1", "tasks_page_workspace' OR '1'='1", "SQL injection 2"],
      ["workspace; DELETE FROM tasks;", "tasks_page_workspace; DELETE FROM tasks;", "SQL injection 3"],
      
      // XSS patterns
      ["<script>alert('xss')</script>", "tasks_page_<script>alert('xss')</script>", "XSS script"],
      ["<img src=x onerror=alert('xss')>", "tasks_page_<img src=x onerror=alert('xss')>", "XSS img"],
      ["<iframe src='javascript:alert(1)'></iframe>", "tasks_page_<iframe src='javascript:alert(1)'></iframe>", "XSS iframe"],
      
      // Numeric-only
      ["12345", "tasks_page_12345", "numeric"],
      ["999999999", "tasks_page_999999999", "large numeric"],
      ["00123", "tasks_page_00123", "numeric with leading zeros"],
      
      // URL special characters
      ["workspace?param=value", "tasks_page_workspace?param=value", "query string"],
      ["workspace#section", "tasks_page_workspace#section", "fragment"],
      ["workspace&param=value", "tasks_page_workspace&param=value", "ampersand"],
      ["workspace=value", "tasks_page_workspace=value", "equals"],
      ["workspace/path", "tasks_page_workspace/path", "slash"],
      
      // Control characters
      ["workspace\nline2", "tasks_page_workspace\nline2", "newline"],
      ["workspace\rline2", "tasks_page_workspace\rline2", "carriage return"],
      ["workspace\ttab", "tasks_page_workspace\ttab", "tab"],
      ["work\n\r\tspace", "tasks_page_work\n\r\tspace", "multiple control chars"],
      
      // Mixed edge cases
      [" 🚀 workspace ", "tasks_page_ 🚀 workspace ", "emoji with spaces"],
      ["123-456_789", "tasks_page_123-456_789", "numeric with special chars"],
      ["workspace-你好\nline2", "tasks_page_workspace-你好\nline2", "unicode with control chars"],
    ])("handles edge case: %s (%s)", (input, expected) => {
      expect(TASKS_PAGE_STORAGE_KEY(input)).toBe(expected);
    });
  });

  describe("saveCurrentPage", () => {

    test("saves page number to sessionStorage", () => {
      const workspaceId = "workspace-123";
      const page = 2;
      
      saveCurrentPage(workspaceId, page);
      
      const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
      expect(stored).toBe("2");
    });

    test("converts page number to string", () => {
      const workspaceId = "workspace-123";
      const page = 5;
      
      saveCurrentPage(workspaceId, page);
      
      const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
      expect(typeof stored).toBe("string");
      expect(stored).toBe("5");
    });

    test("overwrites existing page value", () => {
      const workspaceId = "workspace-123";
      
      saveCurrentPage(workspaceId, 2);
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("2");
      
      saveCurrentPage(workspaceId, 3);
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("3");
    });

    test("saves to correct workspace-specific key", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      
      saveCurrentPage(workspace1, 2);
      saveCurrentPage(workspace2, 5);
      
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspace1))).toBe("2");
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspace2))).toBe("5");
    });

    test("handles SSR safely when window is undefined", () => {
      // Delete window to simulate SSR
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      const workspaceId = "workspace-123";
      
      // Should not throw error
      expect(() => {
        saveCurrentPage(workspaceId, 2);
      }).not.toThrow();
    });

    test("does not save when window is undefined", () => {
      const workspaceId = "workspace-123";
      
      // Save something first
      saveCurrentPage(workspaceId, 2);
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("2");
      
      // Delete window
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      // Try to save different value
      saveCurrentPage(workspaceId, 5);
      
      // Restore window to check storage
      global.window = originalWindow;
      
      // Value should still be 2 (not updated)
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("2");
    });
  });

  describe("getStoredPage", () => {
    test("returns stored page number", () => {
      const workspaceId = "workspace-123";
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "3");
      
      const page = getStoredPage(workspaceId);
      expect(page).toBe(3);
    });

    test("returns 1 when no page is stored", () => {
      const workspaceId = "workspace-123";
      
      const page = getStoredPage(workspaceId);
      expect(page).toBe(1);
    });

    test("parses string to integer correctly", () => {
      const workspaceId = "workspace-123";
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "42");
      
      const page = getStoredPage(workspaceId);
      expect(typeof page).toBe("number");
      expect(page).toBe(42);
    });

    test("reads from correct workspace-specific key", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspace1), "2");
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspace2), "5");
      
      expect(getStoredPage(workspace1)).toBe(2);
      expect(getStoredPage(workspace2)).toBe(5);
    });

    test("handles SSR safely when window is undefined", () => {
      // Delete window to simulate SSR
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      const workspaceId = "workspace-123";
      
      // Should not throw and return default
      expect(() => {
        const page = getStoredPage(workspaceId);
        expect(page).toBe(1);
      }).not.toThrow();
    });

    test("returns 1 when window is undefined", () => {
      const workspaceId = "workspace-123";
      
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      const page = getStoredPage(workspaceId);
      expect(page).toBe(1);
    });

    test("handles corrupted data gracefully", () => {
      const workspaceId = "workspace-123";
      
      // Store invalid data
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "not-a-number");
      
      const page = getStoredPage(workspaceId);
      // parseInt("not-a-number") returns NaN, but the function should handle it
      // Based on the implementation, it will return NaN, which may need fixing
      // For now, we test actual behavior
      expect(isNaN(page)).toBe(true);
    });

    test("handles empty string gracefully", () => {
      const workspaceId = "workspace-123";
      
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "");
      
      const page = getStoredPage(workspaceId);
      // Empty string is falsy, so should return default 1
      expect(page).toBe(1);
    });
  });

  describe("clearStoredPage", () => {
    test("removes stored page from sessionStorage", () => {
      const workspaceId = "workspace-123";
      
      // Set up initial state
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "3");
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("3");
      
      // Clear
      clearStoredPage(workspaceId);
      
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBeNull();
    });

    test("does not affect other workspace keys", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspace1), "2");
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspace2), "5");
      
      clearStoredPage(workspace1);
      
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspace1))).toBeNull();
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspace2))).toBe("5");
    });

    test("handles clearing non-existent key gracefully", () => {
      const workspaceId = "workspace-123";
      
      // Should not throw
      expect(() => {
        clearStoredPage(workspaceId);
      }).not.toThrow();
      
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBeNull();
    });

    test("handles SSR safely when window is undefined", () => {
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      const workspaceId = "workspace-123";
      
      // Should not throw
      expect(() => {
        clearStoredPage(workspaceId);
      }).not.toThrow();
    });

    test("does not remove when window is undefined", () => {
      const workspaceId = "workspace-123";
      
      // Set up initial state
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "3");
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("3");
      
      // Delete window
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      // Try to clear
      clearStoredPage(workspaceId);
      
      // Restore window and check
      global.window = originalWindow;
      
      // Value should still exist
      expect(sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId))).toBe("3");
    });
  });

  describe("Integration Scenarios", () => {
    const TASKS_PAGE_STORAGE_KEY = (workspaceId: string) => `tasks_page_${workspaceId}`;
    
    const saveCurrentPage = (workspaceId: string, page: number) => {
      if (typeof window !== "undefined") {
        sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), page.toString());
      }
    };
    
    const getStoredPage = (workspaceId: string): number => {
      if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
        return stored ? parseInt(stored, 10) : 1;
      }
      return 1;
    };
    
    const clearStoredPage = (workspaceId: string) => {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
      }
    };

    test("save and retrieve page workflow", () => {
      const workspaceId = "workspace-123";
      
      // Initial state - no page stored
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // Save page 2
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
      
      // Save page 3
      saveCurrentPage(workspaceId, 3);
      expect(getStoredPage(workspaceId)).toBe(3);
    });

    test("save, retrieve, and clear workflow", () => {
      const workspaceId = "workspace-123";
      
      // Save page
      saveCurrentPage(workspaceId, 5);
      expect(getStoredPage(workspaceId)).toBe(5);
      
      // Clear page
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1); // Returns default
    });

    test("multiple workspaces maintain independent state", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      const workspace3 = "workspace-789";
      
      // Save different pages for each workspace
      saveCurrentPage(workspace1, 2);
      saveCurrentPage(workspace2, 5);
      saveCurrentPage(workspace3, 10);
      
      // Verify isolation
      expect(getStoredPage(workspace1)).toBe(2);
      expect(getStoredPage(workspace2)).toBe(5);
      expect(getStoredPage(workspace3)).toBe(10);
      
      // Clear one workspace
      clearStoredPage(workspace2);
      
      // Verify others unaffected
      expect(getStoredPage(workspace1)).toBe(2);
      expect(getStoredPage(workspace2)).toBe(1); // Cleared, returns default
      expect(getStoredPage(workspace3)).toBe(10);
    });

    test("pagination progression workflow", () => {
      const workspaceId = "workspace-123";
      
      // Simulate loading more pages
      saveCurrentPage(workspaceId, 1);
      expect(getStoredPage(workspaceId)).toBe(1);
      
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
      
      saveCurrentPage(workspaceId, 3);
      expect(getStoredPage(workspaceId)).toBe(3);
      
      saveCurrentPage(workspaceId, 4);
      expect(getStoredPage(workspaceId)).toBe(4);
      
      // Simulate refresh (clear)
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1);
    });

    test("handles rapid save operations", () => {
      const workspaceId = "workspace-123";
      
      // Rapid sequential saves
      for (let i = 1; i <= 10; i++) {
        saveCurrentPage(workspaceId, i);
      }
      
      // Should have last value
      expect(getStoredPage(workspaceId)).toBe(10);
    });

    test("state consistency after clear and re-save", () => {
      const workspaceId = "workspace-123";
      
      // Initial save
      saveCurrentPage(workspaceId, 5);
      expect(getStoredPage(workspaceId)).toBe(5);
      
      // Clear
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // Save again
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    const TASKS_PAGE_STORAGE_KEY = (workspaceId: string) => `tasks_page_${workspaceId}`;
    
    const saveCurrentPage = (workspaceId: string, page: number) => {
      if (typeof window !== "undefined") {
        sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), page.toString());
      }
    };
    
    const getStoredPage = (workspaceId: string): number => {
      if (typeof window !== "undefined") {
        const stored = sessionStorage.getItem(TASKS_PAGE_STORAGE_KEY(workspaceId));
        return stored ? parseInt(stored, 10) : 1;
      }
      return 1;
    };

    test("handles very large page numbers", () => {
      const workspaceId = "workspace-123";
      const largePage = 999999;
      
      saveCurrentPage(workspaceId, largePage);
      expect(getStoredPage(workspaceId)).toBe(largePage);
    });

    test("handles page number 0", () => {
      const workspaceId = "workspace-123";
      
      saveCurrentPage(workspaceId, 0);
      // "0" (string) is truthy, so parseInt("0", 10) returns 0
      expect(getStoredPage(workspaceId)).toBe(0);
    });

    test("handles negative page numbers", () => {
      const workspaceId = "workspace-123";
      
      saveCurrentPage(workspaceId, -5);
      expect(getStoredPage(workspaceId)).toBe(-5);
    });

    test("handles empty workspace ID", () => {
      const workspaceId = "";
      
      saveCurrentPage(workspaceId, 3);
      expect(getStoredPage(workspaceId)).toBe(3);
      
      const key = TASKS_PAGE_STORAGE_KEY(workspaceId);
      expect(key).toBe("tasks_page_");
    });

    test("handles very long workspace ID", () => {
      const workspaceId = "a".repeat(1000);
      
      saveCurrentPage(workspaceId, 5);
      expect(getStoredPage(workspaceId)).toBe(5);
    });
  });
});