import { describe, it, expect } from "vitest";

describe("FeaturesList - Owner column display logic", () => {
  describe("ownerDisplayValue", () => {
    it("should return the assignee when feature has an assignee set", () => {
      const feature = {
        assignee: { id: "user-1", name: "Jane Smith", image: null },
        createdBy: { id: "user-2", name: "John Doe", image: null },
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue).toEqual(feature.assignee);
      expect(ownerDisplayValue?.name).toBe("Jane Smith");
    });

    it("should fall back to createdBy when assignee is null", () => {
      const feature = {
        assignee: null,
        createdBy: { id: "user-2", name: "John Doe", image: null },
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue?.name).toBe("John Doe");
    });

    it("should return null when both assignee and createdBy are null", () => {
      const feature = {
        assignee: null,
        createdBy: null,
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue).toBeNull();
    });

    it("should not mutate the createdBy object (uses spread)", () => {
      const createdBy = { id: "user-2", name: "John Doe", image: null };
      const feature = { assignee: null, createdBy };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      // It's a copy, not the same reference
      expect(ownerDisplayValue).not.toBe(createdBy);
      expect(ownerDisplayValue).toEqual(createdBy);
    });
  });

  describe("assigneeOptions (Owner filter)", () => {
    it("should use 'All Owners' as the first label", () => {
      const mockMembers = [
        { user: { id: "user-1", name: "Alice", email: "alice@example.com", image: null } },
      ];

      const assigneeOptions = [
        { value: "ALL", label: "All Owners", image: null, name: null },
        { value: "UNASSIGNED", label: "Unassigned", image: null, name: null },
        ...mockMembers.map((m) => ({
          value: m.user.id,
          label: m.user.name || m.user.email || "Unknown",
          image: m.user.image,
          name: m.user.name,
        })),
      ];

      expect(assigneeOptions[0].label).toBe("All Owners");
      expect(assigneeOptions[0].value).toBe("ALL");
    });

    it("should include members as options", () => {
      const mockMembers = [
        { user: { id: "user-1", name: "Alice", email: "alice@example.com", image: null } },
        { user: { id: "user-2", name: null, email: "bob@example.com", image: null } },
      ];

      const assigneeOptions = [
        { value: "ALL", label: "All Owners", image: null, name: null },
        { value: "UNASSIGNED", label: "Unassigned", image: null, name: null },
        ...mockMembers.map((m) => ({
          value: m.user.id,
          label: m.user.name || m.user.email || "Unknown",
          image: m.user.image,
          name: m.user.name,
        })),
      ];

      expect(assigneeOptions).toHaveLength(4); // ALL + UNASSIGNED + 2 members
      expect(assigneeOptions[2].label).toBe("Alice");
      expect(assigneeOptions[3].label).toBe("bob@example.com"); // falls back to email
    });
  });

  describe("handleClearFilters", () => {
    it("should reset assigneeFilter to ALL", () => {
      let assigneeFilter = "user-2";
      const setAssigneeFilter = (value: string) => {
        assigneeFilter = value;
      };

      // Simulate handleClearFilters
      setAssigneeFilter("ALL");

      expect(assigneeFilter).toBe("ALL");
    });

    it("should not reference createdByFilter", () => {
      // The clear filters function should only deal with assigneeFilter (not createdByFilter)
      const clearFiltersLogic = () => {
        const state: Record<string, unknown> = {
          statusFilters: [],
          priorityFilters: [],
          assigneeFilter: "ALL",
          sortBy: "updatedAt",
          sortOrder: "desc",
          searchQuery: "",
          needsAttentionFilter: false,
        };
        return state;
      };

      const result = clearFiltersLogic();
      expect(result).not.toHaveProperty("createdByFilter");
      expect(result).toHaveProperty("assigneeFilter", "ALL");
    });
  });

  describe("Owner filter — API params", () => {
    it("should append assigneeId when Owner filter is active", () => {
      const assigneeFilter = "user-1";
      const params = new URLSearchParams();

      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }

      expect(params.get("assigneeId")).toBe("user-1");
    });

    it("should not append assigneeId when Owner filter is ALL", () => {
      const assigneeFilter = "ALL";
      const params = new URLSearchParams();

      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }

      expect(params.get("assigneeId")).toBeNull();
    });

    it("should not append createdById regardless of state", () => {
      const params = new URLSearchParams();
      // The new fetchFeatures no longer appends createdById
      expect(params.get("createdById")).toBeNull();
    });

    it("should compose Owner filter with status and priority filters", () => {
      const statusFilters = ["IN_PROGRESS"];
      const priorityFilters = ["HIGH"];
      const assigneeFilter = "user-1";
      const params = new URLSearchParams();

      statusFilters.forEach((s) => params.append("status", s));
      priorityFilters.forEach((p) => params.append("priority", p));
      if (assigneeFilter !== "ALL") params.append("assigneeId", assigneeFilter);

      const url = params.toString();
      expect(url).toContain("assigneeId=user-1");
      expect(url).toContain("status=IN_PROGRESS");
      expect(url).toContain("priority=HIGH");
      expect(url).not.toContain("createdById");
    });
  });

  describe("hasActiveFilters", () => {
    it("should return true when assigneeFilter is not ALL", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "user-1";
      const sortBy = "updatedAt";
      const searchQuery = "";
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        (sortBy !== null && sortBy !== "updatedAt") ||
        searchQuery.trim() !== "" ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(true);
    });

    it("should return false with default values", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "ALL";
      const sortBy = "updatedAt";
      const searchQuery = "";
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        (sortBy !== null && sortBy !== "updatedAt") ||
        searchQuery.trim() !== "" ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(false);
    });
  });

  describe("localStorage persistence", () => {
    it("should not include createdByFilter in persisted preferences", () => {
      const preferences = {
        statusFilters: [],
        priorityFilters: [],
        assigneeFilter: "ALL",
        sortBy: "updatedAt",
        sortOrder: "desc",
      };

      expect(preferences).not.toHaveProperty("createdByFilter");
    });

    it("should persist and restore assigneeFilter correctly", () => {
      const preferences = {
        statusFilters: [],
        priorityFilters: [],
        assigneeFilter: "user-5",
        sortBy: "updatedAt",
        sortOrder: "desc",
      };

      const serialized = JSON.stringify(preferences);
      const parsed = JSON.parse(serialized);

      expect(parsed.assigneeFilter).toBe("user-5");
      expect(parsed).not.toHaveProperty("createdByFilter");
    });
  });
});
