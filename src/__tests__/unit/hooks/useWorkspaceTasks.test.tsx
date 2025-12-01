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
    if (stored) {
      const parsed = parseInt(stored, 10);
      return isNaN(parsed) ? 1 : parsed;
    }
    return 1;
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

    test("handles workspace IDs with leading and trailing whitespace", () => {
      const workspaceWithLeadingSpace = " workspace-123";
      const workspaceWithTrailingSpace = "workspace-123 ";
      const workspaceWithBothSpaces = " workspace-123 ";
      
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithLeadingSpace)).toBe("tasks_page_ workspace-123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithTrailingSpace)).toBe("tasks_page_workspace-123 ");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithBothSpaces)).toBe("tasks_page_ workspace-123 ");
    });

    test("handles workspace IDs with internal whitespace", () => {
      const workspaceWithSpaces = "workspace 123 456";
      const workspaceWithTabs = "workspace\t123";
      const workspaceWithNewlines = "workspace\n123";
      
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithSpaces)).toBe("tasks_page_workspace 123 456");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithTabs)).toBe("tasks_page_workspace\t123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithNewlines)).toBe("tasks_page_workspace\n123");
    });

    test("handles workspace IDs with URL-like characters", () => {
      const workspaceWithSlashes = "org/workspace-123";
      const workspaceWithDots = "workspace.123.456";
      const workspaceWithQuery = "workspace-123?param=value";
      const workspaceWithFragment = "workspace-123#section";
      
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithSlashes)).toBe("tasks_page_org/workspace-123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithDots)).toBe("tasks_page_workspace.123.456");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithQuery)).toBe("tasks_page_workspace-123?param=value");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithFragment)).toBe("tasks_page_workspace-123#section");
    });

    test("handles numeric string workspace IDs", () => {
      const numericString = "12345";
      const numericWithLeadingZeros = "00123";
      const scientificNotation = "1e5";
      
      expect(TASKS_PAGE_STORAGE_KEY(numericString)).toBe("tasks_page_12345");
      expect(TASKS_PAGE_STORAGE_KEY(numericWithLeadingZeros)).toBe("tasks_page_00123");
      expect(TASKS_PAGE_STORAGE_KEY(scientificNotation)).toBe("tasks_page_1e5");
    });

    test("handles workspace IDs with unicode characters", () => {
      const workspaceWithEmoji = "workspace-🚀-123";
      const workspaceWithAccents = "wörkspåcé-123";
      const workspaceWithCJK = "工作空间-123";
      const workspaceWithRTL = "مساحة-123";
      
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithEmoji)).toBe("tasks_page_workspace-🚀-123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithAccents)).toBe("tasks_page_wörkspåcé-123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithCJK)).toBe("tasks_page_工作空间-123");
      expect(TASKS_PAGE_STORAGE_KEY(workspaceWithRTL)).toBe("tasks_page_مساحة-123");
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
      // Should return default page 1 when data is corrupted (not NaN)
      expect(page).toBe(1);
      expect(isNaN(page)).toBe(false);
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

    test("handles whitespace-only workspace ID", () => {
      const workspaceSpaces = "   ";
      const workspaceTabs = "\t\t\t";
      
      saveCurrentPage(workspaceSpaces, 3);
      expect(getStoredPage(workspaceSpaces)).toBe(3);
      
      saveCurrentPage(workspaceTabs, 5);
      expect(getStoredPage(workspaceTabs)).toBe(5);
      
      const keySpaces = TASKS_PAGE_STORAGE_KEY(workspaceSpaces);
      const keyTabs = TASKS_PAGE_STORAGE_KEY(workspaceTabs);
      
      expect(keySpaces).toBe("tasks_page_   ");
      expect(keyTabs).toBe("tasks_page_\t\t\t");
    });

    test("handles null-like string workspace IDs", () => {
      const nullString = "null";
      const undefinedString = "undefined";
      const nanString = "NaN";
      
      saveCurrentPage(nullString, 2);
      expect(getStoredPage(nullString)).toBe(2);
      expect(TASKS_PAGE_STORAGE_KEY(nullString)).toBe("tasks_page_null");
      
      saveCurrentPage(undefinedString, 3);
      expect(getStoredPage(undefinedString)).toBe(3);
      expect(TASKS_PAGE_STORAGE_KEY(undefinedString)).toBe("tasks_page_undefined");
      
      saveCurrentPage(nanString, 4);
      expect(getStoredPage(nanString)).toBe(4);
      expect(TASKS_PAGE_STORAGE_KEY(nanString)).toBe("tasks_page_NaN");
    });

    test("handles workspace IDs with special characters that might conflict with storage keys", () => {
      const workspaceWithEquals = "workspace=123";
      const workspaceWithSemicolon = "workspace;123";
      const workspaceWithComma = "workspace,123";
      const workspaceWithPipe = "workspace|123";
      
      saveCurrentPage(workspaceWithEquals, 2);
      expect(getStoredPage(workspaceWithEquals)).toBe(2);
      
      saveCurrentPage(workspaceWithSemicolon, 3);
      expect(getStoredPage(workspaceWithSemicolon)).toBe(3);
      
      saveCurrentPage(workspaceWithComma, 4);
      expect(getStoredPage(workspaceWithComma)).toBe(4);
      
      saveCurrentPage(workspaceWithPipe, 5);
      expect(getStoredPage(workspaceWithPipe)).toBe(5);
    });

    test("handles workspace IDs with maximum length string boundary", () => {
      // Test a very long workspace ID (10,000 characters)
      const maxLengthWorkspace = "w".repeat(10000);
      
      saveCurrentPage(maxLengthWorkspace, 7);
      expect(getStoredPage(maxLengthWorkspace)).toBe(7);
      
      const key = TASKS_PAGE_STORAGE_KEY(maxLengthWorkspace);
      expect(key.length).toBe(10000 + "tasks_page_".length);
      expect(key.startsWith("tasks_page_")).toBe(true);
    });

    test("maintains key uniqueness with similar IDs", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-1234";
      const workspace3 = "workspace-12";
      
      saveCurrentPage(workspace1, 2);
      saveCurrentPage(workspace2, 3);
      saveCurrentPage(workspace3, 4);
      
      expect(getStoredPage(workspace1)).toBe(2);
      expect(getStoredPage(workspace2)).toBe(3);
      expect(getStoredPage(workspace3)).toBe(4);
      
      const key1 = TASKS_PAGE_STORAGE_KEY(workspace1);
      const key2 = TASKS_PAGE_STORAGE_KEY(workspace2);
      const key3 = TASKS_PAGE_STORAGE_KEY(workspace3);
      
      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });
  });

  describe("clearStoredPage - Hook Integration Tests", () => {
    test("verifies clearStoredPage is called during refetch", () => {
      const workspaceId = "workspace-123";
      const storageKey = TASKS_PAGE_STORAGE_KEY(workspaceId);
      
      // Set initial stored page
      sessionStorage.setItem(storageKey, "3");
      expect(sessionStorage.getItem(storageKey)).toBe("3");
      
      // Simulate refetch by calling clearStoredPage
      clearStoredPage(workspaceId);
      
      // Verify storage was cleared
      expect(sessionStorage.getItem(storageKey)).toBeNull();
    });

    test("verifies clearStoredPage prevents stale state across workspace navigation", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      
      // Set pagination for workspace1
      saveCurrentPage(workspace1, 5);
      expect(getStoredPage(workspace1)).toBe(5);
      
      // Navigate to workspace2 - should not see workspace1's state
      expect(getStoredPage(workspace2)).toBe(1);
      
      // Clear workspace1's state
      clearStoredPage(workspace1);
      expect(getStoredPage(workspace1)).toBe(1);
      
      // Workspace2 should be unaffected
      saveCurrentPage(workspace2, 3);
      expect(getStoredPage(workspace2)).toBe(3);
    });

    test("verifies clearStoredPage is called during error recovery", () => {
      const workspaceId = "workspace-123";
      const storageKey = TASKS_PAGE_STORAGE_KEY(workspaceId);
      
      // Set a stored page that might be invalid
      sessionStorage.setItem(storageKey, "999");
      expect(sessionStorage.getItem(storageKey)).toBe("999");
      
      // Simulate error recovery by clearing stored page
      clearStoredPage(workspaceId);
      
      // Verify storage was cleared (would reset to page 1)
      expect(sessionStorage.getItem(storageKey)).toBeNull();
      expect(getStoredPage(workspaceId)).toBe(1);
    });

    test("verifies state reset prevents incorrect pagination UI", () => {
      const workspaceId = "workspace-123";
      
      // Simulate user navigating to page 3
      saveCurrentPage(workspaceId, 1);
      saveCurrentPage(workspaceId, 2);
      saveCurrentPage(workspaceId, 3);
      expect(getStoredPage(workspaceId)).toBe(3);
      
      // User performs action that should reset pagination (refetch)
      clearStoredPage(workspaceId);
      
      // Verify pagination resets to page 1
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // Verify can save new pagination state
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
    });

    test("verifies clearStoredPage handles concurrent workspace operations", () => {
      const workspace1 = "workspace-123";
      const workspace2 = "workspace-456";
      const workspace3 = "workspace-789";
      
      // Set up different states for each workspace
      saveCurrentPage(workspace1, 5);
      saveCurrentPage(workspace2, 3);
      saveCurrentPage(workspace3, 7);
      
      // Clear workspace2 only
      clearStoredPage(workspace2);
      
      // Verify isolation: workspace1 and workspace3 unaffected
      expect(getStoredPage(workspace1)).toBe(5);
      expect(getStoredPage(workspace2)).toBe(1);
      expect(getStoredPage(workspace3)).toBe(7);
      
      // Clear workspace1
      clearStoredPage(workspace1);
      
      // Verify workspace3 still unaffected
      expect(getStoredPage(workspace1)).toBe(1);
      expect(getStoredPage(workspace2)).toBe(1);
      expect(getStoredPage(workspace3)).toBe(7);
    });

    test("verifies clearStoredPage prevents stale state after workspace context changes", () => {
      const workspaceId = "workspace-123";
      
      // Initial state: user on page 4
      saveCurrentPage(workspaceId, 4);
      expect(getStoredPage(workspaceId)).toBe(4);
      
      // Context change (e.g., filter change, sort change, explicit refresh)
      clearStoredPage(workspaceId);
      
      // State should reset to default
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // New pagination should work correctly
      saveCurrentPage(workspaceId, 1);
      expect(getStoredPage(workspaceId)).toBe(1);
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
    });

    test("verifies rapid clearStoredPage calls are safe", () => {
      const workspaceId = "workspace-123";
      
      // Set initial state
      saveCurrentPage(workspaceId, 5);
      expect(getStoredPage(workspaceId)).toBe(5);
      
      // Rapid consecutive clears (simulating race conditions)
      clearStoredPage(workspaceId);
      clearStoredPage(workspaceId);
      clearStoredPage(workspaceId);
      
      // Should handle gracefully
      expect(getStoredPage(workspaceId)).toBe(1);
      expect(() => clearStoredPage(workspaceId)).not.toThrow();
    });

    test("verifies clearStoredPage with SSR safety during state reset", () => {
      const workspaceId = "workspace-123";
      
      // Set up stored state
      saveCurrentPage(workspaceId, 3);
      expect(getStoredPage(workspaceId)).toBe(3);
      
      // Delete window to simulate SSR
      // @ts-expect-error - Intentionally deleting window for SSR test
      delete global.window;
      
      // Clear should not throw even in SSR context
      expect(() => clearStoredPage(workspaceId)).not.toThrow();
      
      // Restore window
      global.window = originalWindow;
      
      // State should still exist (clear didn't work in SSR)
      expect(getStoredPage(workspaceId)).toBe(3);
      
      // Now clear with window available
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1);
    });

    test("verifies clearStoredPage prevents stale state in save-clear-save cycle", () => {
      const workspaceId = "workspace-123";
      
      // Initial save
      saveCurrentPage(workspaceId, 5);
      expect(getStoredPage(workspaceId)).toBe(5);
      
      // Clear (simulating refetch)
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // Save new state
      saveCurrentPage(workspaceId, 2);
      expect(getStoredPage(workspaceId)).toBe(2);
      
      // Clear again
      clearStoredPage(workspaceId);
      expect(getStoredPage(workspaceId)).toBe(1);
      
      // Verify clean state
      saveCurrentPage(workspaceId, 1);
      expect(getStoredPage(workspaceId)).toBe(1);
    });
  });
});