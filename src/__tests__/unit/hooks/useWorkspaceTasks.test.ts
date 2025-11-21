import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { clearStoredPage, TASKS_PAGE_STORAGE_KEY, saveCurrentPage, getStoredPage } from "@/hooks/useWorkspaceTasks";

describe("useWorkspaceTasks - sessionStorage helpers", () => {
  const originalWindow = global.window;
  let mockSessionStorage: {
    removeItem: ReturnType<typeof vi.fn>;
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    key: ReturnType<typeof vi.fn>;
    length: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockSessionStorage = {
      removeItem: vi.fn(),
      getItem: vi.fn(),
      setItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    };

    Object.defineProperty(global, "window", {
      value: {
        sessionStorage: mockSessionStorage,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe("TASKS_PAGE_STORAGE_KEY", () => {
    test("should generate correct storage key pattern", () => {
      const workspaceId = "workspace-123";
      const result = TASKS_PAGE_STORAGE_KEY(workspaceId);

      expect(result).toBe("tasks_page_workspace-123");
    });

    test("should generate different keys for different workspaces", () => {
      const workspace1 = "workspace-abc";
      const workspace2 = "workspace-xyz";

      const key1 = TASKS_PAGE_STORAGE_KEY(workspace1);
      const key2 = TASKS_PAGE_STORAGE_KEY(workspace2);

      expect(key1).toBe("tasks_page_workspace-abc");
      expect(key2).toBe("tasks_page_workspace-xyz");
      expect(key1).not.toBe(key2);
    });

    test("should handle empty string workspaceId", () => {
      const result = TASKS_PAGE_STORAGE_KEY("");

      expect(result).toBe("tasks_page_");
    });

    test("should handle workspaceId with special characters", () => {
      const workspaceId = "workspace-123-test!@#$%";
      const result = TASKS_PAGE_STORAGE_KEY(workspaceId);

      expect(result).toBe("tasks_page_workspace-123-test!@#$%");
    });

    test("should be deterministic for same input", () => {
      const workspaceId = "test-workspace";
      const result1 = TASKS_PAGE_STORAGE_KEY(workspaceId);
      const result2 = TASKS_PAGE_STORAGE_KEY(workspaceId);

      expect(result1).toBe(result2);
      expect(result1).toBe("tasks_page_test-workspace");
    });
  });

  describe("clearStoredPage", () => {
    describe("Basic Functionality", () => {
      test("should remove workspace-specific storage key", () => {
        const workspaceId = "workspace-123";
        const expectedKey = "tasks_page_workspace-123";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledTimes(1);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(expectedKey);
      });

      test("should use TASKS_PAGE_STORAGE_KEY pattern", () => {
        const workspaceId = "test-workspace-456";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      });

      test("should only call removeItem once per invocation", () => {
        const workspaceId = "workspace-single-call";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledTimes(1);
      });
    });

    describe("SSR Safety", () => {
      test("should handle SSR context safely when window is undefined", () => {
        delete (global as any).window;

        expect(() => clearStoredPage("workspace-123")).not.toThrow();
        expect(mockSessionStorage.removeItem).not.toHaveBeenCalled();
      });

      test("should not access sessionStorage when window is undefined", () => {
        const originalWindow = global.window;
        delete (global as any).window;

        clearStoredPage("workspace-ssr-test");

        expect(mockSessionStorage.removeItem).not.toHaveBeenCalled();

        global.window = originalWindow;
      });

      test("should work correctly when window is defined", () => {
        const workspaceId = "workspace-with-window";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      });
    });

    describe("Workspace Isolation", () => {
      test("should clear storage for specific workspace only", () => {
        const workspaceId = "workspace-isolated";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledTimes(1);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_workspace-isolated");
      });

      test("should handle multiple workspace IDs independently", () => {
        const workspace1 = "workspace-alpha";
        const workspace2 = "workspace-beta";

        clearStoredPage(workspace1);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_workspace-alpha");

        vi.clearAllMocks();

        clearStoredPage(workspace2);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_workspace-beta");
      });

      test("should not affect other sessionStorage keys", () => {
        const workspaceId = "workspace-no-side-effects";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.clear).not.toHaveBeenCalled();
        expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
      });
    });

    describe("Edge Cases", () => {
      test("should handle empty string workspaceId", () => {
        clearStoredPage("");

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_");
      });

      test("should handle workspaceId with special characters", () => {
        const workspaceId = "workspace-!@#$%^&*()";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_workspace-!@#$%^&*()");
      });

      test("should handle very long workspaceId", () => {
        const workspaceId = "workspace-" + "a".repeat(1000);

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(`tasks_page_${workspaceId}`);
      });

      test("should handle workspaceId with whitespace", () => {
        const workspaceId = "workspace with spaces";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_workspace with spaces");
      });

      test("should handle numeric string workspaceId", () => {
        const workspaceId = "12345";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith("tasks_page_12345");
      });
    });

    describe("Integration Context", () => {
      test("should clear stored page as part of refetch workflow", () => {
        const workspaceId = "workspace-refetch";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      });

      test("should clear stored page for error recovery", () => {
        const workspaceId = "workspace-error-recovery";

        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      });
    });

    describe("Multiple Invocations", () => {
      test("should handle multiple calls for same workspace", () => {
        const workspaceId = "workspace-multi-call";

        clearStoredPage(workspaceId);
        clearStoredPage(workspaceId);
        clearStoredPage(workspaceId);

        expect(mockSessionStorage.removeItem).toHaveBeenCalledTimes(3);
        expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      });

      test("should handle rapid sequential calls", () => {
        const workspaceIds = ["ws-1", "ws-2", "ws-3"];

        workspaceIds.forEach((id) => clearStoredPage(id));

        expect(mockSessionStorage.removeItem).toHaveBeenCalledTimes(3);
        workspaceIds.forEach((id) => {
          expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(id));
        });
      });
    });
  });

  describe("saveCurrentPage", () => {
    test("should save page number to sessionStorage", () => {
      const workspaceId = "workspace-123";
      const page = 2;

      saveCurrentPage(workspaceId, page);

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId), "2");
    });

    test("should handle SSR context safely", () => {
      delete (global as any).window;

      expect(() => saveCurrentPage("workspace-123", 1)).not.toThrow();
    });

    test("should convert page number to string", () => {
      const workspaceId = "workspace-string-test";
      const page = 5;

      saveCurrentPage(workspaceId, page);

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId), "5");
    });
  });

  describe("getStoredPage", () => {
    test("should retrieve stored page number", () => {
      const workspaceId = "workspace-123";
      mockSessionStorage.getItem.mockReturnValue("3");

      const result = getStoredPage(workspaceId);

      expect(mockSessionStorage.getItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
      expect(result).toBe(3);
    });

    test("should return 1 when no stored page exists", () => {
      const workspaceId = "workspace-no-page";
      mockSessionStorage.getItem.mockReturnValue(null);

      const result = getStoredPage(workspaceId);

      expect(result).toBe(1);
    });

    test("should handle SSR context by returning 1", () => {
      delete (global as any).window;

      const result = getStoredPage("workspace-ssr");

      expect(result).toBe(1);
    });

    test("should parse stored string to integer", () => {
      const workspaceId = "workspace-parse";
      mockSessionStorage.getItem.mockReturnValue("42");

      const result = getStoredPage(workspaceId);

      expect(result).toBe(42);
    });
  });

  describe("Integration Tests", () => {
    test("should work together: save, get, and clear", () => {
      const workspaceId = "workspace-integration";
      const page = 3;

      saveCurrentPage(workspaceId, page);
      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId), "3");

      mockSessionStorage.getItem.mockReturnValue("3");
      const retrievedPage = getStoredPage(workspaceId);
      expect(retrievedPage).toBe(3);

      clearStoredPage(workspaceId);
      expect(mockSessionStorage.removeItem).toHaveBeenCalledWith(TASKS_PAGE_STORAGE_KEY(workspaceId));
    });

    test("should handle complete pagination lifecycle", () => {
      const workspaceId = "workspace-lifecycle";

      saveCurrentPage(workspaceId, 1);
      saveCurrentPage(workspaceId, 2);
      saveCurrentPage(workspaceId, 3);

      mockSessionStorage.getItem.mockReturnValue("3");
      const currentPage = getStoredPage(workspaceId);
      expect(currentPage).toBe(3);

      clearStoredPage(workspaceId);

      mockSessionStorage.getItem.mockReturnValue(null);
      const pageAfterClear = getStoredPage(workspaceId);
      expect(pageAfterClear).toBe(1);
    });
  });
});
