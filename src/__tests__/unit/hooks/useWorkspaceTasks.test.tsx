import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TASKS_PAGE_STORAGE_KEY,
  saveCurrentPage,
  getStoredPage,
  clearStoredPage,
} from "@/hooks/useWorkspaceTasks";

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
      // Should fall back to default page 1 when data cannot be parsed
      expect(page).toBe(1);
      expect(typeof page).toBe("number");
    });

    test("handles empty string gracefully", () => {
      const workspaceId = "workspace-123";
      
      sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), "");
      
      const page = getStoredPage(workspaceId);
      // Empty string is falsy, so should return default 1
      expect(page).toBe(1);
    });

    test("handles various invalid data formats", () => {
      const workspaceId = "workspace-123";
      
      const invalidValues = ["invalid", "abc123", "12.5.3", "null", "undefined", "{}"];
      
      invalidValues.forEach(invalidValue => {
        sessionStorage.setItem(TASKS_PAGE_STORAGE_KEY(workspaceId), invalidValue);
        const page = getStoredPage(workspaceId);
        
        // All invalid formats should fall back to page 1
        expect(page).toBe(1);
        expect(typeof page).toBe("number");
        expect(isNaN(page)).toBe(false);
      });
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
  });
});